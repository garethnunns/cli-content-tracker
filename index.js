#!/usr/bin/env node

import { Command } from 'commander'
import * as fs from 'fs'
import figlet from 'figlet'
import chalk from 'chalk'
import { exit } from 'process'
import Airtable from 'airtable'
import * as Tracker from './Tracker.js'

const fields = ["_path", "_size", "_ctime", "_mtime", "_items"]

const pjson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const program = new Command()
program
	.version(pjson.version)
	.description(pjson.description)
	.option('-c, --config <path>', 'Config file path (if none specified template will be created)')
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
		console.log(chalk.blue("Template file created - please updates with API keys and settings"))
		exit(0)
	}
	catch (err) {
		console.error(chalk.red("Failed to create template config file"))
		console.error(chalk.red(err))
		exit(1)
	}
}

let config

// load config
try {
	config = JSON.parse(fs.readFileSync(options.config, 'utf8'))
}
catch (err) {
	console.error(chalk.red("Failed to load config file"))
	console.error(chalk.red(err))
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

// TODO: check the dir exists and throw an exit code if it doesn't

console.info(chalk.blue("Attempting AirTable connection"))

let base, foldersTable, foldersView, filesTable, filesView
try {
	base = new Airtable({apiKey: config.settings.airtable.api}).base(config.settings.airtable.base)

	foldersTable = base(config.settings.airtable.foldersID)
	foldersView = foldersTable.select({
		view: config.settings.airtable.view,
		fields: fields
	})

	filesTable = base(config.settings.airtable.filesID)
	filesView = filesTable.select({
		view: config.settings.airtable.view,
		fields: fields
	})
}
catch (err) {
	console.error(chalk.red("Failed to make AirTable Connection"))
	console.error(chalk.red(err))
	exit(3)
}

if(config.settings.files.frequency > 0) {
	contentTracker()
	setInterval(contentTracker, config.settings.files.frequency * 1000)
}
else 
	// only run it once if the frequency is 0
	contentTracker()

async function contentTracker() {
	console.info(chalk.blue("Scanning folders"))
	let fileList = Tracker.rList(config.settings.files.dir, config.settings.files.rules)

	if(fileList.dirs.length > 0) {
		// only bother doing this if we found any files

		// airtable excitement proceeds
		console.info(chalk.blue("Fetching folder list from AirTable"))
		let foldersList = await Tracker.airtableToArray(foldersView)
		let filesList = await Tracker.airtableToArray(filesView)

		console.info(chalk.blue("Consoling the differences between the local folders and AirTable"))
		const folderDiffs = Tracker.checkDiffs(fileList.dirs,foldersList)
		console.info(chalk.green(folderDiffs.inserts.length) + " folders to be added")
		console.info(chalk.yellow(folderDiffs.updates.length) + " folders to be modified")
		console.info(chalk.magenta(folderDiffs.deletes.length) + " folders to be deleted")

		console.info(chalk.blue("Consoling the differences between the local files and AirTable"))
		const fileDiffs = Tracker.checkDiffs(fileList.files,filesList)
		console.info(chalk.green(fileDiffs.inserts.length) + " files to be added")
		console.info(chalk.yellow(fileDiffs.updates.length) + " files to be modified")
		console.info(chalk.magenta(fileDiffs.deletes.length) + " files to be deleted")

		console.info(chalk.blue("Updating AirTable"))
		Tracker.updateAT(folderDiffs, foldersTable)
		Tracker.updateAT(fileDiffs, filesTable)
	}
}