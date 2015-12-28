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

const fixturesDir = path.join(__dirname, 'fixtures');
const volatileDir = path.join(__dirname, 'fixtures', 'volatile');

const kronosAdapterInboundFile = require('../index');
const testStep = require('kronos-test-step');
const step = require('kronos-step');

// ---------------------------
// Create a mock manager
// ---------------------------
const manager = testStep.managerMock;

kronosAdapterInboundFile.registerWithManager(manager);

/**
 * This function start the inboundFileAdapter
 * and registers its own generator as an endpoint.
 * So the event will be collected here
 *
 * @param options The options for creating 'adapter-inbound-file'
 * @param messages An array to store the events from the step
 * @return endpoint The 'inFileTrigger' endpoint fo the step
 */
function collect(options, messages) {

	// Stores the error messages
	// Currently the error messges will not be checked.
	let errors = [];

	let inboundFile = manager.getStepInstance(options);
	let outEndPoint = inboundFile.endpoints.out;
	let inEndPoint = inboundFile.endpoints.inFileTrigger;

	inboundFile.error = function (logObject) {
		errors.push(logObject.txt);
	};

	// This endpoint is the OUT endpoint of the previous step.
	// It will be connected with the OUT endpoint of the Adpater
	let sendEndpoint = step.createEndpoint("testEndpointOut", {
		"out": true,
		"active": true
	});

	// This generator emulates the IN endpoint of the next step.
	// It will be connected with the OUT endpoint of the adapter
	let generatorFunction = function* () {
		while (true) {
			const message = yield;
			// only push the file names
			messages.push(message.header.file_name);
		}
	};

	outEndPoint.connectedEndpoint = generatorFunction;
	outEndPoint.outActiveIterator = generatorFunction();
	outEndPoint.outActiveIterator.next();
	inEndPoint.connect(sendEndpoint);

	return {
		"ep": sendEndpoint,
		"inboundFile": inboundFile
	};
}

describe('adapter-inbound-file: external events', function () {

	it('Payload as string, file exists', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {}
		};
		message.payload = path.join(fixturesDir, 'existing_file.csv');

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});


	it('Payload as string, file does NOT exists', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {}
		};
		message.payload = path.join(fixturesDir, 'gumbo.csv');

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, []);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});

	it('Payload as array, one file exists, one does NOT exist', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {}
		};
		message.payload = [path.join(fixturesDir, 'gumbo.csv'), path.join(fixturesDir, 'existing_file.csv')];

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});

	it('Payload as object, one file exists, one does NOT exist, files absolute', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {
				"directory": fixturesDir,
				"files": [path.join(fixturesDir, 'gumbo.csv'), path.join(fixturesDir, 'existing_file.csv')]
			}
		};

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});
	});

	it('Payload as object, one file exists, one does NOT exist, files relative', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {
				"directory": fixturesDir,
				"files": ['gumbo.csv', 'existing_file.csv']
			}
		};

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});
	});

	it('Payload as object, relative file without directory', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": [],
			"payload": {
				"files": ['existing_file.csv']
			}
		};

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, []);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});
	});
	it('No payload in the message', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		let obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": true, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;
		let sendEndpoint = obj.ep;

		let message = {
			"header": {},
			"hops": []
		};

		inboundFile.start().then(function (step) {
			sendEndpoint.send(message);
			setTimeout(function () {
				assert.deepEqual(messages, []);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});
	});

});


describe('adapter-inbound-file: file events', function () {
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

	it('Check that the events for the two new files where thrown', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		const obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": false, // Seems not to work in the test here.
			"watchDir": volatileDir
		}, messages);

		let inboundFile = obj.inboundFile;

		inboundFile.start().then(function (step) {

			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'existing_file_1.csv')));
			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'gum_file_2.csv')));

			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file_1.csv', 'gum_file_2.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});


	it('Check that the regEx filter the file names', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		const obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": false, // Seems not to work in the test here.
			"watchDir": volatileDir,
			"regEx": "^gum_.*\\.csv"
		}, messages);

		let inboundFile = obj.inboundFile;

		inboundFile.start().then(function (step) {

			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'existing_file_1.csv')));
			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'gum_file_2.csv')));

			setTimeout(function () {
				assert.deepEqual(messages, ['gum_file_2.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});

	it('Use an own function to filter the file names', function (done) {
		// Set the timeout for this test
		this.timeout(2000);

		// Stores the messages comming from the step
		let messages = [];

		const obj = collect({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"onlyReadNewFiles": false, // Seems not to work in the test here.
			"watchDir": volatileDir,
			"filter": function (fileName) {
				if (fileName === 'existing_file_1.csv') {
					return true;
				}
				return false;
			}
		}, messages);

		let inboundFile = obj.inboundFile;

		inboundFile.start().then(function (step) {

			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'existing_file_1.csv')));
			fs.createReadStream(path.join(fixturesDir, 'existing_file.csv')).pipe(fs.createWriteStream(path.join(
				volatileDir,
				'gum_file_2.csv')));

			setTimeout(function () {
				assert.deepEqual(messages, ['existing_file_1.csv']);
				done();
			}, 100); // The time needed until the files where written my changs from environment to environment. Maybe it must be increased
		}, function (error) {
			done(error); // 'uh oh: something bad happened’
		});

	});

});

describe('adapter-inbound-file: config', function () {

	it('only name given', function (done) {

		let inboundFile = manager.getStepInstance({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound"
		});

		should.exist(inboundFile);
		assert.typeOf(inboundFile, 'object');

		done();
	});

	it('regEx given', function (done) {
		let inboundFile = manager.getStepInstance({
			"type": "kronos-adapter-inbound-file",
			"name": "myfileInbound",
			"regEx": '.*\\.csv'
		});

		should.exist(inboundFile);
		assert.typeOf(inboundFile, 'object');
		assert.equal(inboundFile.regEx, '/.*\\.csv/');
		done();
	});

	it('ERROR: Filter is not a function', function (done) {
		let fn = function () {
			let inboundFile = manager.getStepInstance({
				"type": "kronos-adapter-inbound-file",
				"name": "myfileInbound",
				"regEx": '.*\\.csv',
				"filter": "a"
			});
		};
		expect(fn).to.throw('Filter must be a function');

		done();
	});
});
