import * as fs from 'fs'
import * as path from 'path'
import _ from 'lodash'

import chalk from 'chalk' // TODO: remove all logging from here...


/**
 * Recursively get all the contained files and folders for the given dir
 * @param {string} dir 
 * @param {array} includes array of regex allowed files
 * @param {*} excludes array of regex excluded files
 * @returns object containing the arrays of objects .dirs & .files
 */
export function rList(dir, includes = [], excludes = []) {
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
 * @returns {array} containing the Regex objectse
 */
export function deserialiseREArray(exps) {
	return exps.map((exp) => {
		const m = exp.match(/\/(.*)\/(.*)?/)
		return new RegExp(m[1], m[2] || "")
	})
}

/**
 * Create array of objects from Airtable view
 * @param {object} view AirTable view containing the fields & records to be returned
 * @returns {array} array of objects
 */
export async function airtableToArray(view) {
	/* get all rows */
	const result = await view.all()

	/* pull raw objects from the result */
	const arr = result.map(r => {
		return {
			id: r.id,
			fields: r.fields
		}
	});

	return arr;
}

/**
 * Work out the differences between local and files on the web
 * @param {array} locals Array of objects of local files
 * @param {array} webs Array of objects of files on AirTable (has ID)
 * @returns Object containing array of .inserts, .updates & .deletes
 */
export function checkDiffs(locals,webs) {

	let result = { updates: [] }

	locals.forEach((local, lIndex) => {
		const wIndex = webs.findIndex(web => local._path == web.fields._path)

		if(wIndex > -1) {
			// found the same file on the web table
			if(!_.isEqual(local,webs[wIndex].fields))
				result.updates.push({
					id: webs[wIndex].id,
					fields: local
				})

			delete locals[lIndex]
			webs.splice(wIndex,1)
		}
	})

	result.inserts = locals.filter(el => el != null)
	result.deletes = webs

	return result
}

/**
 * Update the AirTable table with the specified differences
 * @param {object} diffs object containing the .inserts, .updates & .deletes (from checkDiffs())
 * @param {object} table AirTable table object to update
 */
export function updateAT(diffs, table) {
	// inserts
	for (let i = 0; i < diffs.inserts.length; i+=10) {
		// insert in blocks of 10
		table.create(diffs.inserts.slice(i, i+10).map(r => {return {fields: r}}), (err, records) => {
			if (err) {
				console.error(err)
				return;
			}
			records.forEach(record => {
				console.log(chalk.green("Inserted " + record.get('_path')))
			});
		})
	}
	
	for (let i = 0; i < diffs.updates.length; i+=10) {
		// update in blocks of 10
		table.update(diffs.updates.slice(i, i+10), (err, records) => {
			if (err) {
				console.error(err)
				return
			}
			records.forEach(record => {
				console.log(chalk.yellow("Updated " + record.get('_path')))
			})
		})
	}

	for (let i = 0; i < diffs.deletes.length; i+=10) {
		// delete in blocks of 10
		table.destroy(diffs.deletes.slice(i, i+10).map(r => r.id), (err, records) => {
			if (err) {
				console.error(err)
				return
			}
			console.log(chalk.magenta("Deleted " + records.length + " records"))
		})
	}
}