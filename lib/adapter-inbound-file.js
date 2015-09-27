/* jslint node: true, esnext: true */
"use strict";

const chokidar = require('chokidar');

const fs = require('fs');
const path = require("path");

const baseStep = require('kronos-step').step;
const LOG_LEVEL = require('kronos-step').log_level;
const messageFactory = require('kronos-step').message;

/**
 * Opens a read stream from a file from the file system
 */
class AdapterInboundFile extends baseStep {
	/**
	 * @param kronos The framework manager
	 * @param flow The flow this step was added to
	 * @param config The configration for this step
	 */
	constructor(kronos, flow, config) {
		super(kronos, flow, config);

		if (!config) {
			config = {};
		}

		// A regular expression. The file name must match this expression
		this.regEx = undefined;
		if (config.regEx) {
			this.regEx = new RegExp(config.regEx);
		}

		// an filter function. The function must have the signature
		// @param fileName The name of the file
		// function(fileName){}
		// If it returns a true vale the file will be read
		this.filter = undefined;
		if (config.filter) {
			if (typeof config.filter === 'function') {
				this.filter = config.filter;
			} else {
				throw 'Filter must be a function';
			}
		}

		// watch for changes on the directorys
		this.watchDir = undefined;
		if (config.watchDir) {
			this.watchDir = config.watchDir;
		}

		// if set to true, it will only file added new to the directory.
		// if false, it will start reading all the files in the directory
		this.onlyReadNewFiles = true;
		if (config.onlyReadNewFiles !== undefined) {
			this.onlyReadNewFiles = config.onlyReadNewFiles;
		}
	}

	/**
	 * Initializes the step
	 * Müsste eine promise zurück liefern. Aber für den test hier geht es auch so
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

	}

	_stop() {
		//	this.status = STATUS.stopping;
		if (this.watcher) {
			this.watcher.close();
		}
	}

	/**
	 * receives messages from incomming endpoints
	 */
	_doReceive(endpointName, message) {

		// This endpoint receives messages to read the given file
		if (endpointName === 'inFileTrigger') {
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
							this._logMessage(LOG_LEVEL.error, message, "The 'files' property of the payload object mus be an array",
								'inFileTrigger');
						}
					}
					// take it as an array of strings
				} else {
					this._logMessage(LOG_LEVEL.error, message, "No matching payload in the message for this step", 'inFileTrigger');
				}
			} else {
				this._logMessage(LOG_LEVEL.error, message, "No payload in the message", 'inFileTrigger');
			}
		}
	}

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
				self._logMessage(LOG_LEVEL.error, message, "For reative file names the directory is mandatory", 'inFileTrigger');
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
					self._logMessage(LOG_LEVEL.error, message, `The file '${fileAbs}' does not exists`, 'inFileTrigger');
				}
			});
		}

	}

	/**
	 * This method should be overwritten by the dreived class to setup the endpoints
	 * for this step.
	 */
	_setupEndpoints() {
		// The 'out' endpoint for this steps. This endpoint will emit file read stream requests
		this._addEndpointFromConfig({
			"name": "out",
			"active": true,
			"out": true
		});

		// This 'in' endpoint receives file read events. The payload in the message must have the following format:
		/*
		 * {
		 *  "directory" : dirname
		 *	"files" : [file1, .., fileN]
		 * }
		 * or {fileName}
		 * or [file1, .., fileN]
		 */
		this._addEndpointFromConfig({
			"name": "inFileTrigger",
			"passive": true,
			"in": true
		});
	}

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
				self._push("out", message);
			});
		}
	}

}

module.exports = function (kronos, flow, opts) {
	return new AdapterInboundFile(kronos, flow, opts);
};
