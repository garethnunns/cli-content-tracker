#!/usr/bin/env node

import { Command } from 'commander'
import Conf from 'conf'
import * as path from 'path'
import * as fs from 'fs'
import figlet from 'figlet'
import chalk from 'chalk'
import { exit } from 'process'
import Airtable from 'airtable'
import deepEqual from 'assert'

const conf = new Conf({projectName: 'content-tracker'})

//conf.set('unicorn', '🦄');
//console.log(conf.get('unicorn'));

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
				//dir: import.meta.dirname,
				dir: "/Users/gareth/Desktop/Demo",
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

config.settings.files.includes = deserialiseREArray(config.settings.files.includes)
config.settings.files.excludes = deserialiseREArray(config.settings.files.excludes)

let fileList = rList(config.settings.files.dir, config.settings.files.includes, config.settings.files.excludes)

function rList(dir, includes = [], excludes = []) {
	let result = {
		dirs: [],
		files: []
	}
	const list = fs.readdirSync(dir)

	list.forEach(file => {
		// full file/folder path
		file = path.join(dir, file)

		// work out if we should track this path
		let allowed = false

		if(includes.length)
			includes.array.forEach(include => {
				if(file.match(include))
					allowed = true
			})
		else
			allowed = true

		excludes.forEach(exclude => {
			if(file.match(exclude))
				allowed = false
		})
			

		const stat = fs.statSync(file)
		const fileStat = {
			_path: file,
			_size: stat.size,
			_ctime: stat.ctime.toISOString(),
			_mtime: stat.mtime.toISOString()
		}

		if (stat.isDirectory()) {
			if(allowed) {
				fileStat._items = fs.readdirSync(file).length
				result.dirs.push(fileStat)
			}

			// get everything within that folder
			const subFiles = rList(file, includes, excludes)

			result.dirs = result.dirs.concat(subFiles.dirs)
			result.files = result.files.concat(subFiles.files)
		}
		else {
			// it's a file
			if(allowed)
				result.files.push(fileStat)
		}

	})

	return result
}


/**
 * Deserialise an array of regular expressions (from the config)
 * @param {array} exps array of regular expressions
 * @returns {array}
 */
function deserialiseREArray(exps) {
	return exps.map((exp) => {
		const m = exp.match(/\/(.*)\/(.*)?/)
		return new RegExp(m[1], m[2] || "")
	})
}

/**
 * Recursively goes through the path specified
 * @param {string} dir path
 * @returns 
 */
function walk(dir) {
	var results = [];
	var list = fs.readdirSync(dir)
	list.forEach(file => {
		file = path.join(dir, file)
		results.push(file)
		let stat = fs.statSync(file)
		if (stat && stat.isDirectory())
			// Recurse into a subdirectory
			results = results.concat(walk(file))
	})
	return results
}

/**
 * Get all the contained files and folders for the given dir
 * @param {string} dir path to recursively list
 * @param {array} includes array of regex allowed files
 * @param {array} excludes array of regex excluded files
 * @returns array of files and folders
 */
function getFileList(dir, includes = [], excludes = []) {
	// get all the contents of the folder
	let fileNames = walk(dir)

	if(includes.length)
		// limit to only the files we're after
		fileNames = fileNames.filter((file) => {
				for (let inc = 0; inc < includes.length; inc++)
					return file.match(includes[inc])
			}
		)

	if(excludes.length)
		// remove the excluded files
		fileNames = fileNames.filter((file) => {
				for (let exc = 0; exc < excludes.length; exc++)
					if(file.match(excludes[exc]))
						return false
				return true
			}
		)
	
	return fileNames
}


// airtable excitement proceeds
const base = new Airtable({apiKey: config.settings.airtable.api}).base(config.settings.airtable.base)
const foldersTable = base(config.settings.airtable.foldersID)
const foldersView = foldersTable.select({
	view: config.settings.airtable.view
})

let foldersList = await airtableToArray(foldersView)

/** Create array of objects from Airtable view */
async function airtableToArray(view) {
	/* get all rows */
	const result = await view.all();

	/* pull raw objects from the result */
	const arr = result.map(r => r.fields);
	return arr;
}

function checkDifferences(locals,webs) {
	//console.log(locals)
	//console.log(webs)

	let result = { updates: [] }

	locals.forEach((local, lIndex) => {
		const wIndex = webs.findIndex(web => local._path == web._path)

		if(wIndex > -1) {
			// found the same file on the web table
			if(!deepEqual(local,webs[wIndex]))
				result.updates.push(local)

			delete locals[lIndex]
			webs.splice(wIndex,1)
		}
	})

	result.inserts = locals.filter(el => el != null)
	result.deletes = webs

	return result
}

const diffs = checkDifferences(fileList.dirs,foldersList)