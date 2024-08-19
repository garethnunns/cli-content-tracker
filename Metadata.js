import * as path from 'path'

export class Metadata {
	rootPath = ''

	defaults = {
		fullPath: '',
		size: 0,
		ctime: 0,
		mtime: 0,
		parent: []
	}

	/**
	 * Create a new generic metadata holder
	 * @param {object} metadata containing everything in .defaults
	 */
	constructor(metadata = {}) {
  	this.all = metadata
  }

	get all() {
		let all = {
			rootPath: this.rootPath
		}

		Object.keys(this.defaults).forEach(key => {
			all[key] = this[key]
		})
		
		return all
	}

	set all(values = {}) {
		const valuesWithDefs = {...this.defaults, ...values}

		Object.keys(valuesWithDefs).forEach(key => {
			this[key] = valuesWithDefs[key]
		})
	}

	get path() {
		const projPath = this.fullPath.startsWith(this.rootPath) ? this.fullPath.slice(this.rootPath.length) : this.fullPath
		// normalise it to a unix style path
		return projPath.replaceAll(path.sep, path.posix.sep)
	}

	get fields() {
		// this is what is sent to AirTable
		let fields = {}

		this.keys.forEach(key => {
			fields["_" + key] = this[key]
		})
		
		return fields
	}

	get keys() {
		return ["path", ...Object.keys(this.defaults)]
	}

	get _keys() {
		// these are the fields AirTable will need
		return this.keys.map(key => "_" + key)
	}

	get parentPath() {
		return path.dirname(this.path)
	}
}

export class MetadataFolder extends Metadata {
	defaults = {
		...this.defaults,
		items: 0
	}

	/**
	 * Create a new generic metadata for folders
	 * @param {object} metadata containing everything in .defaults
	 */
	constructor(metadata = {}) {
		super(metadata)
		this.all = metadata
  }
}

/**
 * Currently there just in case we need to store any extra bits specifically for files
 */
export class MetadataFile extends Metadata {

}

export class MetadataFileMedia extends Metadata {
	defaults = {
		...this.defaults,
  	duration: 0,
    video: false,
    videoStill: false,
    videoCodec: "",
    videoWidth: 0,
    videoHeight: 0,
    videoFormat: "",
    videoAlpha: false,
    videoFPS: 0,
    videoBitRate: 0,
    audio: false,
    audioCodec: "",
    audioSampleRate: 0,
    audioChannels: 0,
    audioBitRate: 0
  }

	/**
	 * Create a new generic metadata for media files
	 * @param {object} metadata containing everything in .defaults
	 */
	constructor(metadata = {}) {
		super(metadata)
		this.all = metadata
  }

	get fields() {
		let fields = super.fields

		return fields
	}
}