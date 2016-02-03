/* jslint node: true, esnext: true */
"use strict";

const AdpaterInboundFileFactory = require('./lib/adapter-inbound-file');

exports.adpaterInboundFile = AdpaterInboundFileFactory;

exports.registerWithManager = manager => Promise.all([
	manager.registerStep(AdpaterInboundFileFactory)
]);
