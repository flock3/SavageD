// Copyright (c) 2013 Mediasift Ltd
// All rights reserved

// our built-in includes
var fs   = require("fs");
var util = require("util");

// our third-party includes
var _        = require("underscore");
var dsCommon = require("dsCommon");

function ServerCpu(appServer) {
	// call our parent constructor
	ServerCpu.super_.call(this, appServer, {
		name: "ServerCpu"
	});

	// add ourselves to the list of available plugins
	appServer.serverMonitor.addPlugin("cpu", this);

	// our absolute CPU stats
	this.cpuStats = {};

	// our last diff of the CPU stats
	this.cpuStatsDiff = {};
}
module.exports = ServerCpu;
util.inherits(ServerCpu, dsCommon.dsFeature);

ServerCpu.prototype.canMonitorServer = function() {
	// can we see the /proc/stat file?
	if (!fs.existsSync("/proc/stat")) {
		return false;
	}

	return true;
};

ServerCpu.prototype.getCpuStats = function() {
	// self-reference
	var self = this;

	// what are we doing?
	// this.logInfo("report server cpu usage");

	// we can get the information we need from the server's stat file
	var filename = "/proc/stat";

	// this will hold the processed contents of the stat file
	var results = {};

	// does the path exist?
	if (!fs.existsSync(filename)) {
		throw new Error("Cannot find file " + filename);
	}

	// this will hold the raw contents of the status file
	var content = fs.readFileSync(filename, "ascii");
	var parsed = null;

	_.each(content.split("\n"), function(line) {
		// peak size of the virtual memory of the process
		if (line.match(/^cpu[0-9]{0,3} /)) {
			// get the individual fields
			// parsed = line.split(/^([a-z][0-9]+)[ ]{1,4}([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+).*/);
			parsed = line.split(/\s+/);

			// break them out
			results[parsed[0]] = {
				user:       parseInt(parsed[1], 10),
				nice:       parseInt(parsed[2], 10),
				system:     parseInt(parsed[3], 10),
				idle:       parseInt(parsed[4], 10),
				iowait:     parseInt(parsed[5], 10),
				irq:        parseInt(parsed[6], 10),
				softirq:    parseInt(parsed[7], 10),
				steal:      parseInt(parsed[8], 10),
				guest:      parseInt(parsed[9], 10),
				guest_nice: parseInt(parsed[10], 10)
			};

			// we need a total, to make any sense of them
			results[parsed[0]].total = _.reduce(results[parsed[0]], function(previousValue, currentValue, index, array) { return previousValue + currentValue; }, 0);
		}
	});

	// all done
	return results;
};

ServerCpu.prototype.diffCpuStats = function(oldStats, newStats) {
	var results = {};

	// work out the number of jiffies that have occured
	// between our two sample points
	_.each(oldStats, function(cpu, cpuName) {
		results[cpuName] = {};
		_.each(cpu, function(value, fieldName) {
			results[cpuName][fieldName] = newStats[cpuName][fieldName] - value;
		});
	});

	// all done
	return results;
};

ServerCpu.prototype.statsToPercent = function(stats) {
	var results = {};

	// use that 'total' field we created for ourselves to convert
	// the jiffies into a percentage for each CPU
	_.each(stats, function(cpu, cpuName) {
		results[cpuName] = {};
		_.each(cpu, function(value, fieldName) {
			// calculate the percentage, to 2 decimal places
			results[cpuName][fieldName] = Math.round((parseFloat(value) / parseFloat(stats[cpuName].total)) * 10000.0) / 100.0;
		});
	});

	// all done
	return results;
};

ServerCpu.prototype.reportUsage = function(alias) {
	// self-reference
	var self = this;

	// get the current CPU stats
	var stats = this.getCpuStats();

	// is this the first time?
	if (this.cpuStats.cpu === undefined) {
		// special case - first time we've grabbed the stats
		this.cpuStats = stats;

		// nothing to report this time around, as we have no CPU stats
		// to compare against
		this.logInfo("No CPU stats to diff yet");
		return;
	}

	// if we get here, then we can diff the stats
	var diff = this.diffCpuStats(this.cpuStats, stats);

	// convert the numbers to percentages
	var percentages = this.statsToPercent(diff);

	// remember these stats for next time
	this.cpuStats = stats;

	// remember the stats, for other plugins to use
	this.cpuStatsDiff = diff;

	// at this point, we have data to send to statsd
	_.each(percentages, function(cpu, cpuName) {
		_.each(cpu, function(value, fieldName) {
			self.appServer.statsManager.count(alias + ".cpu." + cpuName + "." + fieldName, value);
		});
	});
};