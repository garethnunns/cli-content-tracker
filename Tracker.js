import * as fs from 'fs'
import * as path from 'path'
import _ from 'lodash'
import { logger } from './logger.js' // TODO: remove all logging from here...

import { Level } from 'level'
const db = new Level('./.db', { valueEncoding: 'json' })

import * as ffmpegStatic from 'ffmpeg-static'
import * as ffprobeStatic from 'ffprobe-static'
import FfmpegCommand from 'fluent-ffmpeg'

FfmpegCommand.setFfmpegPath(ffmpegStatic.path);
FfmpegCommand.setFfprobePath(ffprobeStatic.path)
FfmpegCommand.setFfmpegPath(ffmpegStatic)

import { Metadata, MetadataFolder, MetadataFileMedia, MetadataFile } from './Metadata.js'

const metadataFolder = new MetadataFolder()
const metadataFile = new MetadataFile()
const metadataFileMedia = new MetadataFileMedia()

export const dirFields = metadataFolder.keys
export const fileFields = metadataFile.keys
export const fileMediaFields = metadataFileMedia.keys

export const dirDefaults = metadataFolder.fields
export const fileDefaults = metadataFile.fields
export const fileMediaDefaults = metadataFileMedia.fields

/**
 * Recursively get all the contained files and folders for the given dir
 * @param {string} dir 
 * @param {object} includes object containing the rules for including and excluding dirs/files
 * @param {boolean} metadata whether to get all the file metadata
 * @returns object containing the arrays of objects .dirs & .files
 */
export async function rList(dir, rules, metadata = false) {
	let result = {
		dirs: [],
		files: []
	}
	const list = fs.readdirSync(dir)

	await Promise.all(list.map(async (file) => {
		// full file/folder path
		file = path.join(dir, file)

		try {
			const stat = fs.statSync(file)

			const pathMeta = new Metadata({
				path: file,
				size: stat.size,
				ctime: stat.ctime.toISOString(),
				mtime: stat.mtime.toISOString()
			})

			if (stat.isDirectory()) {
				if(isAllowed(file, rules.dirs)) {
					let folderMeta = new MetadataFolder(pathMeta.all)
					folderMeta.items = fs.readdirSync(file).length
					result.dirs.push(folderMeta.fields)
				}

				// get everything within that folder
				const subFiles = await rList(file, rules, metadata)

				result.dirs = result.dirs.concat(subFiles.dirs)
				result.files = result.files.concat(subFiles.files)
			}
			else {
				// it's a file
				if(isAllowed(file, rules.files)) {
					let fileMeta = new MetadataFile(pathMeta.all)

					if(metadata)
						fileMeta = await getFileMetadata(fileMeta)
							.catch(err => {
								logger.warn("Issue getting metadata for %s", file)
								logger.error("[%s] %s", err.name, err.message)
								fileMeta = new MetadataFileMedia(pathMeta.all)
							})
					
					result.files.push(fileMeta.fields)
				}
			}
		}
		catch (err) {
			logger.warn("Failed to read %s", file)
			logger.error("[%s] %s", err.name, err.message)
		}
	}))

	return result
}

/**
 * Get all the metadata for a file using 
 * @param {MetadataFile} fileMeta MetadataFile object containing a path to the item
 * @returns {Promise} resolve contains Metadata object
 */
function getFileMetadata(fileMeta) {
	return new Promise((resolve, reject) => {
		FfmpegCommand.ffprobe(fileMeta.path, async (err, metadata) => {
			if(err)
				reject(err)

			let mediaMeta = new MetadataFileMedia(fileMeta.all)

			let cacheMeta
			try{
				cacheMeta = await db.get(fileMeta.path)
			}
			catch(err) {
				logger.debug("Fetching metadata for %s", mediaMeta.path)
			}

			if(cacheMeta !== undefined) {
				logger.debug("Retreived cached metadata for %s", mediaMeta.path)
				// found the item in cache
				mediaMeta.all = cacheMeta
				resolve(mediaMeta)
			}
			
			const videoStream = metadata?.streams.find((stream) => stream.codec_type == 'video')
			const audioStream = metadata?.streams.find((stream) => stream.codec_type == 'audio')
	
			mediaMeta.video = videoStream !== undefined
			mediaMeta.videoStill = metadata?.format.format_long_name.includes("sequence") ?? false
			
			const duration = metadata?.format.duration ?? 0
			mediaMeta.duration = duration != 'N/A' ? duration : 0
			
			mediaMeta.videoCodec = videoStream?.codec_name ?? ''
			mediaMeta.videoCodec = videoStream?.codec_name ?? ''
			mediaMeta.videoWidth = videoStream?.width ?? 0
			mediaMeta.videoHeight = videoStream?.height ?? 0
			mediaMeta.videoFormat = videoStream?.pix_fmt ?? ''

			// TODO: need to cross-reference list of possible alpha pixel formats...
			mediaMeta.videoAlpha = videoStream?.pix_fmt.includes('a') ?? false
			mediaMeta.videoFPS = mediaMeta.videoStill ? 0 : mediaMeta.video ? Number(videoStream.r_frame_rate.split('/')[0]) : 0
			mediaMeta.videoBitRate = mediaMeta.video ? (videoStream.bit_rate != 'N/A' ? videoStream.bit_rate : 0) : 0

			mediaMeta.audio = audioStream !== undefined
			mediaMeta.audioCodec = audioStream?.codec_name ?? '',
			mediaMeta.audioSampleRate = audioStream?.sample_rate ?? 0,
			mediaMeta.audioChannels = audioStream?.channels ?? 0,
			mediaMeta.audioBitRate = audioStream?.bit_rate ?? 0

			db.put(mediaMeta.path, mediaMeta.all)
			
			resolve(mediaMeta)
		})
	})
}

/**
 * Work out if we're allowed a file based on the rules
 * @param {string} file file path to match
 * @param {object} rules object of arrays .includes & .excludes
 * @returns {boolean}
 */
export function isAllowed(file, rules) {
	// assume we're not allowed it
	let allowed = false

	if(rules.includes.length)
		// if we're being selective then it must match one of the allowed
		rules.includes.forEach(include => {
			if(file.match(include))
				allowed = true
		})
	else
		// otherwise everything goes
		allowed = true

	// unless it's not allowed in the excludes
	rules.excludes.forEach(exclude => {
		if(file.match(exclude))
			allowed = false
	})

	return allowed
}

/**
 * Wipe any of the existing metadata cache
 */
export function clearCache() {
	db.clear()
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
 * @param {object} defaults provide if you want to fill empty values
 * @returns {array} array of objects
 */
export async function airtableToArray(view, defaults = {}) {
	// get all rows
	const rows = await view.all()

	// return the id and fields from the fetched rows
	return rows.map(r => {
		return {
			id: r.id,
			fields: {...defaults, ...r.fields}
		}
	})
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
export async function updateAT(diffs, table, tableName, callback) {
	// store all the promises
	let proms = {
		inserts: [],
		updates: [],
		deletes: []
	}

	let result = {
		inserts: [],
		updates: [],
		deletes: 0
	}

	let error = ""

	// inserts
	for (let i = 0; i < diffs.inserts.length; i+=10) {
		// insert in blocks of 10
		proms.inserts.push(table.create(diffs.inserts.slice(i, i+10).map(r => {return {fields: r}})).then(records => {
			records.forEach(record => result.inserts.push(record.get('_path')))
		}))
	}
	
	for (let i = 0; i < diffs.updates.length; i+=10) {
		// update in blocks of 10
		proms.updates.push(table.update(diffs.updates.slice(i, i+10)).then(records => {
			records.forEach(record => result.updates.push(record.get('_path')))
		}))
	}

	for (let i = 0; i < diffs.deletes.length; i+=10) {
		// delete in blocks of 10
		proms.deletes.push(table.destroy(diffs.deletes.slice(i, i+10).map(r => r.id)).then((records) => {
			result.deletes += records.length
		}))
	}

	// if anything fails add it to the communal error
	Promise.all([...proms.inserts, ...proms.updates, ...proms.deletes]).catch(err => {
		if (err) {
			error += err + "\n"
		}
	})
	
	// wait for it to finish everything
	Promise.allSettled([...proms.inserts, ...proms.updates, ...proms.deletes]).then(r => callback(tableName, error, result))
}