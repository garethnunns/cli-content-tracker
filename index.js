#!/usr/bin/env node

import { Command } from 'commander'
import Conf from 'conf'
import * as path from 'path'
import * as fs from 'fs'
import figlet from 'figlet'
import chalk from 'chalk'
import { exit } from 'process'

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
        dir: import.meta.dirname,
        frequency: 30,
        includes: [],
        excludes: [
          /\.DS_Store$/
        ]
      },
      airtable: {
        api: ''
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

// if they have been deleted for whatever reason add them back as empty arrays
config.settings.files.includes = config?.settings?.files?.includes ?? []
config.settings.files.excludes = config?.settings?.files?.excludes ?? []

config.settings.files.includes = deserialiseREArray(config.settings.files.includes)
config.settings.files.excludes = deserialiseREArray(config.settings.files.excludes)

console.log(getFileList(config.settings.files.dir, config.settings.files.includes, config.settings.files.excludes))

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
function getFileList(dir, includes, excludes) {
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