#!/usr/bin/env node

import { Command } from 'commander'
import * as fs from 'fs'
import figlet from 'figlet'
import chalk from 'chalk'
import { exit } from 'process'
import Airtable from 'airtable'
import * as Tracker from './Tracker.js'
import { logger } from './logger.js'

const loadJSON = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)))
const pjson = loadJSON('./package.json')

const program = new Command()
program
	.version(pjson.version)
	.description(pjson.description)
	.option('-c, --config <path>', 'Config file path (if none specified template will be created)')
	.option('-d, --dry-run','Will do everything apart from updating AirTable')
	.parse(process.argv);

const options = program.opts()

// this bit is really important, don't remove
console.log(chalk.magenta(figlet.textSync("Content Tracker")))

if(!options.config) {
	// no config file specified

	// default config file
	const defaults = {
		settings: {
			files: {
				dir: import.meta.dirname,
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
				}
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
		logger.error(err)
		exit(1)
	}
}

let config

// load config
try {
	config = JSON.parse(fs.readFileSync(options.config, 'utf8'))
}
catch (err) {
	logger.warn("Failed to load config file")
	logger.error(err)
	exit(2)
}

// TODO: find a better way of validating the whole config file
// if they have been deleted for whatever reason add them back as empty arrays
//config.settings.files.includes = config?.settings?.files?.includes ?? []
//config.settings.files.excludes = config?.settings?.files?.excludes ?? []

// convert JSON stringified regex into proper regex
for(let type in config.settings.files.rules)
	for(let rule in config.settings.files.rules[type])
		config.settings.files.rules[type][rule] = Tracker.deserialiseREArray(config.settings.files.rules[type][rule])

try {
	fs.readdirSync(config.settings.files.dir)
}
catch(err) {
	logger.warn('Could not access the folder "%s"', config.settings.files.dir)
	logger.error(err)
	exit(3)
}

logger.verbose("Attempting AirTable connection")

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
		fields: Tracker.fileFields
	})
}
catch (err) {
	logger.error("Failed to make AirTable Connection")
	logger.error(err)
	exit(4)
}

if(config.settings.files.frequency > 0) {
	contentTracker()
	setInterval(contentTracker, config.settings.files.frequency * 1000)
}
else 
	// only run it once if the frequency is 0
	contentTracker()

async function contentTracker() {
	logger.verbose("Scanning folders")
	let fileList = Tracker.rList(config.settings.files.dir, config.settings.files.rules)
	logger.info("Found %d folders & %d files ", fileList.dirs.length, fileList.files.length)

	if(fileList.dirs.length > 0) {
		// only bother doing this if we found any files

		// airtable excitement proceeds
		logger.verbose("Fetching folder list from AirTable")
		
		let foldersList, filesList = []
		
		try {
			foldersList = await Tracker.airtableToArray(foldersView)
			filesList = await Tracker.airtableToArray(filesView)
		}
		catch(err) {
			logger.warn("Failed to fetch folder list")
			logger.error(err)
			return
		}

		logger.verbose("Consoling the differences between the local folders and AirTable")
		const folderDiffs = Tracker.checkDiffs(fileList.dirs, foldersList)
		logDiffs("Folders", folderDiffs)

		logger.verbose("Consoling the differences between the local files and AirTable")
		const fileDiffs = Tracker.checkDiffs(fileList.files, filesList)
		logDiffs("Files", fileDiffs)

		if(!options.dryRun) {
			logger.verbose("Updating AirTable")
			try {
				Tracker.updateAT(folderDiffs, foldersTable, "Folders", logUpdates)
				Tracker.updateAT(fileDiffs, filesTable, "Files", logUpdates)
			}
			catch (err) {
				logger.warn("Issue updating AirTable")
				logger.error(err)
			}
		}
		else {
			logger.debug("[DRY RUN] -  Folders:")
			logger.verbose(folderDiffs)

			logger.debug(chalk.bgBlue("[DRY RUN] -  Files:"))
			logger.verbose(fileDiffs)
		}
	}
}

function logDiffs(tableName, diffs) {
	logger.info("AT %s Table: %d to add, %d to update & %d to delete", tableName, diffs.inserts.length, diffs.updates.length, diffs.deletes.length)
}

function logUpdates(tableName, err, res) {
	logger.info("AT %s Table: %d added, %d updated & %d deleted", tableName, res.inserts.length, res.updates.length, res.deletes)

	res.inserts.forEach(insert => logger.verbose("Inserted %s", insert))
	res.updates.forEach(update => logger.verbose("Updated %s", update))
	if(err) {
		logger.warn("Error updating %s table", tableName)
		logger.error(err)
	}
}