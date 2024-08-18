import { promises as fs } from 'fs'
import * as path from 'path'
import _ from 'lodash'
import { logger } from './logger.js' // TODO: remove all logging from here...

import PQueue from 'p-queue'

import { Level } from 'level'
const db = new Level('./.db', { valueEncoding: 'json' })

import * as ffmpegStatic from 'ffmpeg-static'
import * as ffprobeStatic from 'ffprobe-static'
import FfmpegCommand from 'fluent-ffmpeg'

FfmpegCommand.setFfmpegPath(ffmpegStatic.path)
FfmpegCommand.setFfprobePath(ffprobeStatic.path)

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

const defaultRListOptions = {
	rules: {
		dirs: {
			includes: [],
			excludes: []
		},
		files: {
			includes: [],
			excludes: []
		}
	},
	mediaMetadata: true,
	limitToFirstFile: false,
	concurrency: 10
}

/**
 * Get the contents of all the dirs recursively
 * @param {array} dirs array of folder path
 * @param {object} options rules, mediaMetadata, limitToFirstFile & concurrency
 * @returns object containing the arrays of MetadataFolder & MetadataFile(Media)
 */
export async function rLists(dirs, options = {}) {
	options = {...defaultRListOptions, ...options}

	let result = {
		dirs: [],
		files: []
	}

	for(const dir of dirs) {
		const fileList = await rList(dir, options)
		result.dirs.push(...fileList.dirs)
		result.files.push(...fileList.files)
	}

	return result
}

/**
 * Recursively get all the contained files and folders for the given dir
 * @param {string} dir 
 * @param {object} object rules, mediaMetadata, limitToFirstFile & concurrency
 * @returns object containing the arrays of MetadataFolder & MetadataFile(Media)
 */
export async function rList(dir, options = {}) {
	options = {...defaultRListOptions, ...options}

	let result = {
		dirs: [],
		files: []
	}

	logger.silly("Finding files in %s",dir)

	let list = [dir] // add the root folder in
	try {
		list.push(...await fs.readdir(dir))
	}
	catch (err) {
		logger.warn("Failed to read the folder %s", dir)
		logger.error("[%s] %s", err.name, err.message)
	}

	let firstFile = list.map(file => path.join(dir, file)).find(file => path.extname(file) && isAllowed(file, options.rules.files))

	const queue = new PQueue({concurrency: options.concurrency})

	const listQueue = queue.addAll(list.map((file) => {
		return async () => {
			const rootFolder = file == dir
			
			if(!rootFolder)
				// full file/folder path
				file = path.join(dir, file)

			try {
				const stat = await fs.stat(file)

				const pathMeta = new Metadata({
					path: file,
					size: stat.size,
					ctime: stat.ctime.toISOString(),
					mtime: stat.mtime.toISOString()
				})

				if (stat.isDirectory()) {
					if(!rootFolder) {
						queue.pause() // take a breather on this folder whilst we look at the subfolder

						// get everything within that folder
						const subFiles = await rList(file, options)

						queue.start() // carry on with the folder above

						result.dirs = result.dirs.concat(subFiles.dirs)
						result.files = result.files.concat(subFiles.files)
					}
					else if(isAllowed(file, options.rules.dirs)) {
						let folderMeta = new MetadataFolder(pathMeta.all)
						folderMeta.items = list.length - 1
						result.dirs.push(folderMeta)
					}
				}
				else {
					// it's a file
					if(isAllowed(file, options.rules.files)
					&& (!options.limitToFirstFile || options.limitToFirstFile && (firstFile === undefined || firstFile == file) )) {
						// either we're not limited to the first file, or we are and this is the first
						firstFile = false
						
						let fileMeta = new MetadataFile(pathMeta.all)

						if(options.mediaMetadata)
							fileMeta = await getFileMetadata(fileMeta)
								.catch(err => {
									logger.warn("Issue getting metadata for %s", file)
									logger.error("[%s] %s", err.name, err.message)

									// return the file with the default extended metadata
									return new MetadataFileMedia(pathMeta.all)
								})
						
						result.files.push(fileMeta)
					}
				}
			}
			catch (err) {
				logger.warn("Failed to read %s", file)
				logger.error("[%s] %s", err.name, err.message)
			}
		}
	}))

	await listQueue

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
				logger.silly("No cache found for %s", mediaMeta.path)
			}

			if(cacheMeta !== undefined 
				&& cacheMeta.size == mediaMeta.size 
				&& cacheMeta.mtime == mediaMeta.mtime) {
				// found the item in cache and it matches the size and last modified time
				
				logger.silly("Retreived cached metadata for %s", mediaMeta.path)
				mediaMeta.all = cacheMeta
				resolve(mediaMeta)
			}
			else {
				logger.silly("Fetching metadata for %s", mediaMeta.path)
			
				const videoStream = metadata?.streams.find((stream) => stream.codec_type == 'video')
				const audioStream = metadata?.streams.find((stream) => stream.codec_type == 'audio')
		
				mediaMeta.video = videoStream !== undefined
				mediaMeta.videoStill = metadata?.format?.format_long_name.includes("sequence") ?? false
				
				// see if it's there
				let duration = metadata?.format?.duration ?? 0
				// if it's a still or irrelevant set it to 0
				duration = (duration != 'N/A') || !mediaMeta.videoStill ? duration : 0
				// round to it 2dp
				mediaMeta.duration = Math.round(duration * 100) / 100
				
				mediaMeta.videoCodec = videoStream?.codec_name ?? ''
				mediaMeta.videoCodec = videoStream?.codec_name ?? ''
				mediaMeta.videoWidth = videoStream?.width ?? 0
				mediaMeta.videoHeight = videoStream?.height ?? 0
				mediaMeta.videoFormat = videoStream?.pix_fmt ?? ''

				// TODO: need to cross-reference list of possible alpha pixel formats...
				mediaMeta.videoAlpha = videoStream?.pix_fmt.includes('a') ?? false

				let FPS = videoStream?.r_frame_rate.split('/')[0] / videoStream?.r_frame_rate.split('/')[1]
				mediaMeta.videoFPS = (FPS && !mediaMeta.videoStill) ? Math.round(FPS * 100) / 100 : 0
				mediaMeta.videoBitRate = mediaMeta.video ? (videoStream.bit_rate != 'N/A' ? videoStream.bit_rate : 0) : 0

				mediaMeta.audio = audioStream !== undefined
				mediaMeta.audioCodec = audioStream?.codec_name ?? '',
				mediaMeta.audioSampleRate = audioStream?.sample_rate ?? 0,
				mediaMeta.audioChannels = audioStream?.channels ?? 0,
				mediaMeta.audioBitRate = audioStream?.bit_rate ?? 0

				try {
					await db.put(mediaMeta.path, mediaMeta.all)
				}
				catch(err) {
					logger.warn("Failed to store cache for %s", mediaMeta.path)
					logger.error("[%s] %s", err.name, err.message)
				}
				
				resolve(mediaMeta)
			}
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
export function wipeCache() {
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
 * @param {array} locals array of Metadata objects
 * @param {array} webs array of objects of dirs/files on AirTable (has ID)
 * @param {array} folderList array of objects of folders on AirTable (has ID)
 * @returns Object containing array of .inserts, .updates & .deletes
 */
export function checkDiffs(locals, webs, folderList = []) {
	// clone these as we are going to edit their contents
	locals = _.cloneDeep(locals)
	webs = _.cloneDeep(webs)

	let result = { updates: [] }

	locals.forEach((local, lIndex) => {
		const wIndex = webs.findIndex(web => local.fields._path == web.fields._path)

		const parentID = folderList.find(folder => folder.fields._path == local.parentPath)?.id
		if(parentID)
			local.parent = [parentID]

		if(wIndex > -1) {
			// found the same file on the web table
			if(!_.isEqual(local.fields, webs[wIndex].fields))
				// but the one on the web is different so add to the updates list
				result.updates.push({
					id: webs[wIndex].id,
					fields: local.fields
				})

			// remove this out of the local/web lists
			delete locals[lIndex]
			webs.splice(wIndex,1)
		}
	})

	// ones to insert are the ones that are only present locally
	result.inserts = locals.filter(el => el != null).map(el => el.fields)
	
	// ones to delete are the ones that are only present in the web list
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