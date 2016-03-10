/* global describe, it, beforeEach */
/* jslint node: true, esnext: true */

"use strict";

const chai = require('chai');
const assert = chai.assert;
const expect = chai.expect;
const should = chai.should();

const fs = require('fs');
const path = require("path");
const rimraf = require('rimraf');
const merge = require('merge-light');

const fixturesDir = path.join(__dirname, 'fixtures');
const volatileDir = path.join(__dirname, 'fixtures', 'volatile');

const kronosAdapterInboundFile = require('../index');
const testStep = require('kronos-test-step');
const step = require('kronos-step');
const endpoint = require('kronos-endpoint');
const serviceManager = require('kronos-service-manager');

// ---------------------------
// Create a mock manager
// ---------------------------
const managerPromise = serviceManager.manager().then(manager =>
	Promise.all([
		kronosAdapterInboundFile.registerWithManager(manager)
	]).then(() =>
		Promise.resolve(manager)
	));


/**
 * This function start the inboundFileAdapter
 * and registers its own generator as an endpoint.
 * So the event will be collected here
 *
 * @param options The options for creating 'adapter-inbound-file'
 * @param messages An array to store the events from the step
 * @return endpoint The 'inFileTrigger' endpoint fo the step
 */
function collect(manager, options, messages) {
	// Stores the error messages
	// Currently the error messges will not be checked.
	let errors = [];

	let inboundFile = manager.createStepInstanceFromConfig(options, manager);
	let outEndPoint = inboundFile.endpoints.out;
	let inEndPoint = inboundFile.endpoints.inFileTrigger;

	inboundFile.error = function (logObject) {
		errors.push(logObject.txt);
	};


	// This endpoint is the IN endpoint of the next step.
	// It will be connected with the OUT endpoint of the Adpater
	let receiveEndpoint = new endpoint.ReceiveEndpoint("testEndpointIn");

	// This endpoint is the OUT endpoint of the previous step.
	// It will be connected with the OUT endpoint of the Adpater
	let sendEndpoint = new endpoint.SendEndpoint("testEndpointOut");

	receiveEndpoint.receive = function (message) {
		messages.push(message.info.file_name);
		return Promise.resolve();
	};

	outEndPoint.connected = receiveEndpoint;
	sendEndpoint.connected = inEndPoint;

	return {
		"ep": sendEndpoint,
		"inboundFile": inboundFile
	};
}


function handleExternalEvents(payload, expectedMessages, objectAddOns, isExternalEvent) {
	if (!objectAddOns) {
		objectAddOns = {};
	}
	return managerPromise.then(manager => {

		// Stores the messages comming from the step
		let messages = [];

		let baseConfig = {
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		};

		baseConfig = Object.assign(baseConfig, objectAddOns);
		baseConfig = merge(baseConfig, objectAddOns);

		const obj = collect(manager, baseConfig, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"info": {},
			"hops": [],
			"payload": payload
		};

		return inboundFile.start().then(function (step) {
			if (isExternalEvent) {
				sendEndpoint.receive(message);
			} else {
				fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
					volatileDir,
					'existing_file_1.csv')));
				fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
					volatileDir,
					'gum_file_2.csv')));
			}
			return new Promise(function (resolve, reject) {
				setTimeout(function () {
					assert.deepEqual(messages, expectedMessages);
					resolve("OK");
				}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
			});
		});
	});
}

describe('adapter-inbound-file: external events', function () {
	// Set the timeout for this test
	this.timeout(2000);

	it('Payload as string, file exists', function () {
		return handleExternalEvents(path.join(fixturesDir, 'existing_file.csv'), ['existing_file.csv'], {}, 1);
	});

	it('Payload as string, file does NOT exists', function () {
		return handleExternalEvents(path.join(fixturesDir, 'gumbo.csv'), [], {}, 1);
	});

	it('Payload as array, one file exists, one does NOT exist', function () {
		return handleExternalEvents([path.join(fixturesDir, 'gumbo.csv'), path.join(fixturesDir, 'existing_file.csv')], [
			'existing_file.csv'
		], {}, 1);
	});

	it('Payload as object, one file exists, one does NOT exist, files absolute', function () {
		return handleExternalEvents({
			"directory": fixturesDir,
			"files": [path.join(fixturesDir, 'gumbo.csv'), path.join(fixturesDir, 'existing_file.csv')]
		}, ['existing_file.csv'], {}, 1);
	});

	it('Payload as object, one file exists, one does NOT exist, files relative', function () {
		return handleExternalEvents({
			"directory": fixturesDir,
			"files": ['gumbo.csv', 'existing_file.csv']
		}, ['existing_file.csv'], {}, 1);
	});

	it('Payload as object, relative file without directory', function () {
		return handleExternalEvents({
			"files": ['existing_file.csv']
		}, [], {}, 1);
	});

	it('No payload in the message', function () {
		return handleExternalEvents({}, [], {}, 1);
	});

});

describe('adapter-inbound-file: file events', function () {
	// Set the timeout for this test
	this.timeout(2000);

	/**
	 * Clears the test directory. This is the monitored directoy where the files will be created
	 */
	beforeEach(function () {
		// Delete all the the 'volatile' directory
		try {
			rimraf.sync(volatileDir);
		} catch (err) {
			console.log(err);
		}
		fs.mkdirSync(volatileDir);
	});

	it('Check that the events for the two new files where thrown', function () {
		return handleExternalEvents({}, ['existing_file_1.csv', 'gum_file_2.csv'], {
			"onlyReadNewFiles": false
		}, 0);
	});

	it('Check that the regEx filter the file names', function () {
		return handleExternalEvents({}, ['gum_file_2.csv'], {
			"onlyReadNewFiles": false,
			"regEx": "^gum_.*\\.csv"
		}, 0);
	});

	it('Use an own function to filter the file names', function () {
		return handleExternalEvents({}, ['existing_file_1.csv'], {
			"onlyReadNewFiles": false,
			"filter": function (fileName) {
				if (fileName === 'existing_file_1.csv') {
					return true;
				}
				return false;
			}
		}, 0);
	});

});



describe('adapter-inbound-file: config', function () {

	it('only name given', function () {
		return managerPromise.then(manager => {

			let inboundFile = manager.createStepInstanceFromConfig({
				"type": "kronos-adapter-inbound-file",
				"name": "myfileInbound"
			}, manager);

			should.exist(inboundFile);
			assert.typeOf(inboundFile, 'object');
			return Promise.resolve("OK");
		});
	});

	it('regEx given', function () {
		return managerPromise.then(manager => {
			let inboundFile = manager.createStepInstanceFromConfig({
				"type": "kronos-adapter-inbound-file",
				"name": "myfileInbound",
				"regEx": '.*\\.csv'
			}, manager);

			should.exist(inboundFile);
			assert.typeOf(inboundFile, 'object');
			assert.equal(inboundFile.regEx, '/.*\\.csv/');
			return Promise.resolve("OK");
		});
	});

	it('ERROR: Filter is not a function', function () {
		return managerPromise.then(manager => {
			let fn = function () {
				let inboundFile = manager.createStepInstanceFromConfig({
					"type": "kronos-adapter-inbound-file",
					"name": "myfileInbound",
					"regEx": '.*\\.csv',
					"filter": "a"
				}, manager);
			};
			expect(fn).to.throw('Filter must be a function');

			return Promise.resolve("OK");
		});
	});
});
