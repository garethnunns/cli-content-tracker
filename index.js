#!/usr/bin/env node

import { Command } from 'commander'
import Conf from 'conf'
import * as fs from 'fs'
import figlet from 'figlet'
import chalk from 'chalk'

const config = new Conf({projectName: 'content-tracker'})

config.set('unicorn', '🦄');
console.log(config.get('unicorn'));

const pjson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const program = new Command()
program
  .version(pjson.version)
  .description(pjson.description)
  .option('-g, --greet', 'Say hello')
  .parse(process.argv);

const options = program.opts()

console.log(chalk.magenta(figlet.textSync("Content Tracker")))

if (options.greet) {
  console.log(chalk.blue('Hello world!'))
}