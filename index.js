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

	RegExp.prototype.toJSON = RegExp.prototype.toString

	// default config file
	const defaults = {
		settings: {
			files: {
				dir: import.meta.dirname,
				frequency: 30,
				includes: [],
				excludes: [
					/\.DS_Store$/
				]
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

// load config
const config = JSON.parse(fs.readFileSync(options.config, 'utf8'))

// if they have been deleted for whatever reason add them back as empty arrays
config.settings.files.includes = config?.settings?.files?.includes ?? []
config.settings.files.excludes = config?.settings?.files?.excludes ?? []

config.settings.files.includes = Tracker.deserialiseREArray(config.settings.files.includes)
config.settings.files.excludes = Tracker.deserialiseREArray(config.settings.files.excludes)

// TODO: check the dir exists and throw an exit code if it doesn't

console.info(chalk.blue("Attempting AirTable connection"))
const base = new Airtable({apiKey: config.settings.airtable.api}).base(config.settings.airtable.base)
const foldersTable = base(config.settings.airtable.foldersID)
const foldersView = foldersTable.select({
	view: config.settings.airtable.view,
	fields: fields
})

// TODO: make sure all the airtable connections have worked at this point...

contentTracker()

async function contentTracker() {
	console.info(chalk.blue("Scanning folders"))
	let fileList = Tracker.rList(config.settings.files.dir, config.settings.files.includes, config.settings.files.excludes)

	if(fileList.dirs.length > 0) {
		// only bother doing this if we found any files

		// airtable excitement proceeds
		console.info(chalk.blue("Fetching folder list from AirTable"))
		let foldersList = await Tracker.airtableToArray(foldersView)

		console.info(chalk.blue("Consoling the differences between the local files and AirTable"))

		const diffs = Tracker.checkDiffs(fileList.dirs,foldersList)

		console.info(chalk.blue("Updating AirTable"))
		console.info(chalk.green(diffs.inserts.length) + " folders to be added")
		console.info(chalk.yellow(diffs.updates.length) + " folders to be modified")
		console.info(chalk.magenta(diffs.deletes.length) + " folders to be deleted")

		Tracker.updateAT(diffs, foldersTable)
	}
}