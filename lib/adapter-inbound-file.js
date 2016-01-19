/* jslint node: true, esnext: true */
"use strict";

const chokidar = require('chokidar');

const fs = require('fs');
const path = require("path");

const BaseStep = require('kronos-step').Step;


const AdapterInboundFile = {
	"name": "kronos-adapter-inbound-file",
	"description": "Watches directories and opens a stream for new files matching the expected file name",
	"endpoints": {
		"inFileTrigger": {
			"in": true
		},
		"out": {
			"out": true
		}
	},


	initialize(manager, scopeReporter, name, stepConfiguration, props) {

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

			this.info({
				"short_message": "Stop watching directory"
			});

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


			self.info({
				"short_message": "Start watching directory",
				"directory": self.watchDir
			});

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
		return Promise.resolve();
	},

	finalize(manager, scopeReporter, stepConfiguration) {
		const self = this;
		const inEndpoint = self.endpoints.inFileTrigger;

		let generatorInitialized = false;

		inEndpoint.receive = function (message) {

			return new Promise(function (fulfill, reject) {
				if (message.payload) {
					if (typeof message.payload === 'string') {
						// take the payload as a single file name
						fulfill(self._parseInboundFileMessage(undefined, message.payload, message));
					} else if (Array.isArray(message.payload)) {
						// take it as an array of file names

						const promises = [];
						for (let i = 0; i < message.payload.length; i++) {
							// iterate over the files
							promises.push(self._parseInboundFileMessage(undefined, message.payload[i], message));
						}

						fulfill(Promise.all(promises));

					} else if (typeof message.payload === 'object') {
						if (message.payload.files) {
							let directory;
							if (message.payload.directory) {
								directory = message.payload.directory;
							}
							if (Array.isArray(message.payload.files)) {

								const promises = [];

								for (let i = 0; i < message.payload.files.length; i++) {
									// iterate over the files
									promises.push(self._parseInboundFileMessage(directory, message.payload.files[i], message));
								}

								fulfill(Promise.all(promises));
							} {
								const msg = {
									"message": message,
									"short_message": "The 'files' property of the payload object must be an array",
									"endpoint": "inFileTrigger"
								};
								self.error(msg);
								reject(msg);
							}
						}
						// take it as an array of strings
					} else {
						const msg = {
							"message": message,
							"short_message": "No matching payload in the message for this step",
							"endpoint": "inFileTrigger"
						};
						self.error(msg);
						reject(msg);
					}
				} else {
					const msg = {
						"message": message,
						"short_message": "No payload in the message",
						"endpoint": "inFileTrigger"
					};
					self.error(msg);
					reject(msg);
				}

			});
		};

	},


	/**
	 * Checks the inbound file message.
	 * Does the files exists and converst the file names and directoryies
	 * in a way that the normal function could handle it
	 * @return Promise
	 */
	_parseInboundFileMessage(directory, fileName, message) {
		let fileAbs;
		let fileDir;
		let fileRel;

		const self = this;

		return new Promise(function (fulfill, reject) {
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
					const msg = {
						"message": message,
						"short_message": "For reative file names the directory is mandatory",
						"endpoint": "inFileTrigger"
					};

					self.error(msg);
					reject(msg);
				}
			}

			if (fileAbs) {
				// check that the file exists

				fs.access(fileAbs, fs.R_OK, function (err) {
					if (err) {
						// write error log
						const msg = {
							"message": message,
							"short_message": `The file '${fileAbs}' does not exists`,
							"endpoint": "inFileTrigger"
						};
						self.error(msg);
						reject(msg);
					} else {
						// ok, trigger the file
						fulfill(self._createReadStreamMessage(fileAbs, fileRel, fileDir, message));
					}
				});


			} else {
				reject("unexpected ERROR");
			}
		});


	},

	/**
	 * Opens the readFileStream and pushes the event to the next step
	 * @param absFileName The absolute file name.
	 * @param fileName The file name without the path
	 * @param directory The directory the file is in
	 * @param messageToClone If the file comes from an external trigger, some message informations
	 * needs to be copied from the trigger message.
	 * @return Promise
	 */
	_createReadStreamMessage(absFileName, fileName, directory, messageToClone) {
		const self = this;
		const outEndpoint = self.endpoints.out;

		let stream = fs.createReadStream(absFileName);
		if (stream) {

			const message = {
				"info": {
					"file_name": fileName,
					"directory": directory
				}
			};

			message.payload = stream;

			// Get the file stats as sdditional information on the request
			return new Promise(function (fulfill, reject) {
				fs.stat(absFileName, function (err, stats) {
					if (err) {
						reject(err);
					} else {
						message.info.file_stat = stats;
						fulfill(
							outEndpoint.connected.receive(message, messageToClone));
					}
				});
			});

		}
	}

};

module.exports = Object.assign({}, BaseStep, AdapterInboundFile);
