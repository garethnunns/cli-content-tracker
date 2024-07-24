#!/usr/bin/env node

const { program } = require('commander')
const pkg = require('./package.json')

program
  .version(pkg.version)
  .description('A simple CLI tool example')
  .option('-g, --greet', 'Say hello world')
  .parse(process.argv);

const options = program.opts()

if (options.greet) {
  console.log('Hello world!')
}