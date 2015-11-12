/* jslint node: true, esnext: true */
"use strict";

const chokidar = require('chokidar');

const fs = require('fs');
const path = require("path");

const BaseStep = require('kronos-step').Step;
const messageFactory = require('kronos-message');


const AdapterInboundFile = {
	"name": "kronos-adapter-inbound-file",
	"description": "Watches directories and opens a stream for new files matching the expected file name",
	"endpoints": {
		"inFileTrigger": {
			"in": true,
			"passive": true
		},
		"out": {
			"out": true,
			"active": true
		}
	},


	initialize(manager, scopeReporter, name, stepConfiguration, endpoints, props) {

		// A regular expression. The file name must match this expression
		let regEx;
		if (stepConfiguration.regEx) {
			regEx = new RegExp(stepConfiguration.regEx);
		}
		props.regEx = {
			value: regEx
		};


		// an filter function. The function must have the signature
		// @param fileName The name of the file
		// function(fileName){}
		// If it returns a true vale the file will be read
		let filter;
		if (stepConfiguration.filter) {
			if (typeof stepConfiguration.filter === 'function') {
				filter = stepConfiguration.filter;
			} else {
				throw 'Filter must be a function';
			}
		}
		props.filter = {
			value: filter
		};


		// watch for changes on the directorys
		let watchDir;
		if (stepConfiguration.watchDir) {
			watchDir = stepConfiguration.watchDir;
		}
		props.watchDir = {
			value: watchDir
		};

		// if set to true, it will only file added new to the directory.
		// if false, it will start reading all the files in the directory
		let onlyReadNewFiles = true;
		if (stepConfiguration.onlyReadNewFiles !== undefined) {
			onlyReadNewFiles = stepConfiguration.onlyReadNewFiles;
		}
		props.onlyReadNewFiles = {
			value: onlyReadNewFiles
		};
	},

	/**
	 * Stops the watcher
	 * Overwrite to implement the functionality to bring the step into the stopped state.
	 * @return {Promise} default implementation always fullfills with the receiving step
	 */
	_stop() {
		if (this.watcher) {
			this.watcher.close();
		}
		return Promise.resolve(this);
	},

	/**
	 * Starts the step
	 * Start the watcher which checks for changes in the given directory
	 */
	_start() {
		const self = this;
		if (self.watchDir) {
			let opt = {};
			if (self.onlyReadNewFiles) {
				opt.ignoreInitial = true;
			}

			self.watcher = chokidar.watch(self.watchDir, opt).on('add', function (filePath) {

				let absFileName = path.resolve(filePath);
				let fileDir = path.dirname(absFileName);
				let fileName = path.basename(absFileName);

				if (self.filter) {
					if (self.filter(fileName)) {
						self._createReadStreamMessage(absFileName, fileName, fileDir);
					}
				} else {
					if (self.regEx) {
						if (fileName.match(self.regEx)) {
							self._createReadStreamMessage(absFileName, fileName, fileDir);
						}
					} else {
						self._createReadStreamMessage(absFileName, fileName, fileDir);
					}
				}

			});
		}
		return Promise.resolve(this);
	},

	finalize(manager, scopeReporter, stepConfiguration) {
		const self = this;
		const inEndpoint = self.endpoints.inFileTrigger;
		inEndpoint.setPassiveGenerator(function* () {
			while (self.isRunning) {
				let currentRequest = yield;
				self._receiveTriggerMessages(currentRequest);
			}
		});
	},

	/**
	 * receives messages from incomming triggerEndPoint
	 */
	_receiveTriggerMessages(message) {

		if (message.payload) {
			if (typeof message.payload === 'string') {
				// take the payload as a single file name
				this._parseInboundFileMessage(undefined, message.payload, message);
			} else if (Array.isArray(message.payload)) {
				// take it as an array of file names
				for (let i = 0; i < message.payload.length; i++) {
					// iterate over the files
					this._parseInboundFileMessage(undefined, message.payload[i], message);
				}
			} else if (typeof message.payload === 'object') {
				if (message.payload.files) {
					let directory;
					if (message.payload.directory) {
						directory = message.payload.directory;
					}
					if (Array.isArray(message.payload.files)) {
						for (let i = 0; i < message.payload.files.length; i++) {
							// iterate over the files
							this._parseInboundFileMessage(directory, message.payload.files[i], message);
						}
					} {
						this.error({
							"message": message,
							"txt": "The 'files' property of the payload object must be an array",
							"endpoint": "inFileTrigger"
						});
					}
				}
				// take it as an array of strings
			} else {
				this.error({
					"message": message,
					"txt": "No matching payload in the message for this step",
					"endpoint": "inFileTrigger"
				});
			}
		} else {
			this.error({
				"message": message,
				"txt": "No payload in the message",
				"endpoint": "inFileTrigger"
			});
		}

	},
	/**
	 * Checks the inbound file message.
	 * Does the files exists and converst the file names and directoryies
	 * in a way that the normal function could handle it
	 */
	_parseInboundFileMessage(directory, fileName, message) {
		let fileAbs;
		let fileDir;
		let fileRel;

		const self = this;

		if (path.isAbsolute(fileName)) {
			// The given file name is absolute
			fileAbs = fileName;
			fileDir = path.dirname(fileName);
			fileRel = path.basename(fileName);
		} else {
			// the file name is relative
			if (directory) {
				// build the absolute name
				fileDir = directory;
				fileRel = fileName;
				fileAbs = path.resolve(path.join(directory, fileName));
			} else {
				// error for relative file names the directory is needed
				self.error({
					"message": message,
					"txt": "For reative file names the directory is mandatory",
					"endpoint": "inFileTrigger"
				});
			}
		}

		if (fileAbs) {
			// check that the file exists
			fs.exists(fileAbs, function (exists) {
				if (exists) {
					// ok, trigger the file
					self._createReadStreamMessage(fileAbs, fileRel, fileDir, message);
				} else {
					// write error log
					self.error({
						"message": message,
						"txt": `The file '${fileAbs}' does not exists`,
						"endpoint": "inFileTrigger"
					});
				}
			});
		}

	},

	/**
	 * Opens the readFileStream and pushes the event to the next step
	 * @param absFileName The absolute file name.
	 * @param fileName The file name without the path
	 * @param directory The directory the file is in
	 * @param messageToClone If the file comes from an external trigger, some message informations
	 * needs to be copied from the trigger message.
	 */
	_createReadStreamMessage(absFileName, fileName, directory, messageToClone) {
		const self = this;
		const outEndpoint = self.endpoints.out;

		let stream = fs.createReadStream(absFileName);
		if (stream) {

			const message = messageFactory({
				"file_name": fileName,
				"directory": directory
			}, messageToClone);

			message.payload = stream;
			// Get the file stats as sdditional information on the request
			fs.stat(absFileName, function (stats) {
				message.header.file_stat = stats;
				outEndpoint.send(message);
			});
		}
	}


};

module.exports = Object.assign({}, BaseStep, AdapterInboundFile);
