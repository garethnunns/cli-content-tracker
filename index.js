#!/usr/bin/env node

import Airtable from 'airtable'
import chalk from 'chalk'
import { Command } from 'commander'
import figlet from 'figlet'
import * as fs from 'fs'
import confirm from '@inquirer/confirm'
import { exit } from 'process'
import * as Tracker from './Tracker.js'
import { logger } from './logger.js'

const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)))
const pjson = loadJSON('./package.json')

const program = new Command()
program
	.version(pjson.version)
	.description(pjson.description)
	.option('-c, --config <path>', 'config file path (if none specified template will be created)')
	.option('-d, --dry-run','will do everything apart from updating AirTable')
	.option('-l, --logging <level>','set the logging level')
	.option('-nc, --no-confirm', 'never ask for confirmation before making large changes')
	.option('-nd, --no-delete', 'never remove records from AirTable')
	.option('-w, --wipe-cache', 'clear the metadata cache')
	.parse(process.argv);

const options = program.opts()

// this bit is really important, don't remove
console.log(chalk.cyanBright(figlet.textSync("Content Tracker")))

if(options.logging && options.logging in logger.levels)
	logger.transports[0].level = options.logging

if(!options.config) {
	// no config file specified

	// default config file
	const defaults = {
		settings: {
			files: {
				rootPath: import.meta.dirname,
				dirs: [
					import.meta.dirname
				],
				frequency: 30,
				rules: {
					dirs: {
						includes: [],
						excludes: []
					},
					files: {
						includes: [],
						excludes: [
							/\.DS_Store$/
						]
					}
				},
				mediaMetadata: true,
				limitToFirstFile: false,
				concurrency: 100
			},
			airtable: {
				api: '',
				base: '',
				foldersID: '',
				filesID: '',
				view: 'API'
			}
		}
	}

	// write the config file
	try {
		// cast regex to string on stringify
		RegExp.prototype.toJSON = RegExp.prototype.toString

		fs.writeFileSync('config.json',JSON.stringify(defaults,null,2))
		logger.warn("Template config file created - please updates with settings & API keys, then re-run with -c <path>")
		exit(0)
	}
	catch (err) {
		logger.warn("Failed to create template config file")
		logger.error("[%s] %s", err.name, err.message)
		exit(1)
	}
}

if(options.wipeCache) {
	logger.warn("Wiping cache")
	Tracker.wipeCache()
}

let config

// load config
try {
	config = JSON.parse(fs.readFileSync(options.config, 'utf8'))
}
catch (err) {
	logger.warn("Failed to load config file")
	logger.error("[%s] %s", err.name, err.message)
	exit(2)
}

// TODO: find a better way of validating the whole config file - use a config module

// convert JSON stringified regex into proper regex
for(let type in config.settings.files.rules)
	for(let rule in config.settings.files.rules[type])
		config.settings.files.rules[type][rule] = Tracker.deserialiseREArray(config.settings.files.rules[type][rule])

logger.http("Attempting AirTable connection")

let base, foldersTable, foldersView, filesTable, filesView
try {
	base = new Airtable({apiKey: config.settings.airtable.api}).base(config.settings.airtable.base)

	foldersTable = base(config.settings.airtable.foldersID)
	foldersView = foldersTable.select({
		view: config.settings.airtable.view,
		fields: Tracker.dirFields
	})

	filesTable = base(config.settings.airtable.filesID)
	filesView = filesTable.select({
		view: config.settings.airtable.view,
		fields: config.settings.files.mediaMetadata ?  Tracker.fileMediaFields : Tracker.fileFields
	})
}
catch (err) {
	logger.error("Failed to make AirTable Connection")
	logger.error("[%s] %s", err.name, err.message)
	exit(4)
}

contentTracker()

async function contentTracker() {
	logger.verbose("Scanning folders")
	let fileList = await Tracker.rLists(config.settings.files.dirs, {
		rootPath: config.settings.files.rootPath,
		rules: config.settings.files.rules,
		mediaMetadata: config.settings.files.mediaMetadata,
		limitToFirstFile: config.settings.files.limitToFirstFile,
		concurrency: config.settings.files.concurrency
	})
	logger.info("Found %d folders & %d files ", fileList.dirs.length, fileList.files.length)

	if(fileList.dirs.length > 0) {
		// only bother doing this if we found any files

		// airtable excitement proceeds
		logger.http("Fetching folder list from AirTable")
		
		let foldersList, filesList = []
		
		try {
			foldersList = await Tracker.airtableToArray(foldersView, Tracker.dirDefaults)
			const fileDefaults = config.settings.files.mediaMetadata ? Tracker.fileMediaDefaults : Tracker.fileDefaults
			filesList = await Tracker.airtableToArray(filesView, fileDefaults)
		}
		catch(err) {
			logger.warn("Failed to fetch file/folder list")
			logger.error("[%s] %s", err.name, err.message)
			return
		}

		logger.verbose("Consoling the differences between the local file system and AirTable")
		let folderDiffs = Tracker.checkDiffs(fileList.dirs, foldersList, foldersList)
		let fileDiffs = Tracker.checkDiffs(fileList.files, filesList, foldersList)

		if(!options.delete) {
			// remove all deletions
			folderDiffs.deletes = []
			fileDiffs.deletes = []
		}

		logDiffs("folders", folderDiffs, options.dryRun)
		logDiffs("files", fileDiffs, options.dryRun)

		if(!options.dryRun) {
			if(options.confirm) {
				await confirmDeletes(folderDiffs,foldersList, "folders")
				await confirmDeletes(fileDiffs,filesList, "files")
			}

			logger.http("Updating AirTable")
			try {
				await Tracker.updateAT(folderDiffs, foldersTable, "Folders", logUpdates)
				await Tracker.updateAT(fileDiffs, filesTable, "Files", logUpdates)
			}
			catch (err) {
				logger.warn("Issue updating AirTable")
				logger.error("[%s] %s", err.name, err.message)
			}
		}
	}

	if(config.settings.files.frequency > 0) {
		console.debug("Waiting...")
		setTimeout(contentTracker, config.settings.files.frequency * 1000)
	}
}

function logDiffs(tableName, diffs, dry = false) {
	let totalChanges = Object.values(diffs).reduce(
		(total, changes) => total + changes.length,
		0
	)

	let pre = (dry ? "[DRY RUN] - " : "")

	logger.info(pre + "AT %s table - %d changes", tableName, totalChanges)
	
	pre += "%d %s to %s"

	for(const changes in diffs) {
		const action = changes.slice(0, -1)
		logger.verbose(pre, diffs[changes].length, tableName, action)
		if(diffs[changes].length && (dry || action == "delete"))
			diffs[changes].forEach(change => {
				logger.debug(chalk.bgBlueBright("to %s:") + " %s", action, change?.fields?._path ?? change._path)
			})
	}
}

function logUpdates(tableName, err, res) {
	logger.info("AT %s Table: %d added, %d updated & %d deleted", tableName, res.inserts.length, res.updates.length, res.deletes)

	res.inserts.forEach(insert => logger.debug(chalk.bgBlueBright("inserted:") + " %s", insert))
	res.updates.forEach(update => logger.debug(chalk.bgBlueBright("updated:") + " %s", update))
	if(err) {
		logger.warn("Error updating %s table", tableName)
		logger.error(err)
	}
}

async function confirmDeletes(diffs, remoteList, tableName) {
	if(diffs.deletes.length > remoteList.length * 0.1) {
		logger.warn("This will remove over 10% of %s in AirTable", tableName)
		const confirmed = await asyncCallWithTimeout(confirm({ message: `Would you like to remove the ${diffs.deletes.length} ${tableName}?` }), 60 * 1000)
		if(!confirmed)
			diffs.deletes = []
	}
}

async function asyncCallWithTimeout(asyncPromise, timeLimit) {
	let timeoutHandle;

	const timeoutPromise = new Promise((resolve, _reject) => {
			timeoutHandle = setTimeout(
					() => {
						logger.info('Confirm timed out')
						resolve(false)
					},
					timeLimit
			);
	});

	return Promise.race([asyncPromise, timeoutPromise]).then(result => {
			clearTimeout(timeoutHandle)
			return result
	})
}