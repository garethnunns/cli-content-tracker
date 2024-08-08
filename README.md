# CLI Content Tracker to AirTable

This project came about as a means to track video content on concert shows, but is written generically. It recursively scans folders, which can be mapped network drives or streamed cloud storage like Dropbox, Drive, LucidLink or Suite and stores a list of the files & folders on AirTable.

## Quick Start

```sh
npx @garethnunns/cli-content-tracker
```

Then you just need to [edit the `config.json` file](#config-file) that was created where the command was executed and re-run with the [config command line option `tracker -c`](#config-option--c---config-).

_Will require Node to be installed, if on Mac probably install with Homebrew:_
```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

## AirTable Setup

You can duplicate [this base](https://airtable.com/appPF3qIAsOaGMz9z/shr6Hx4YgXryKvy3e) or create your own detailed below. See the section on [configuring the settings for AirTable](#configsettingsairtable) on how to link this to the script.

### Manual Base Creation

You'll need a base with the two following tables for folders & files.

#### Folders Table

| Field       | Description                                 | Type
| ---         | ---                                         | ---
| `_path`     | Will store the full path of the folder      | Single line text
| `_size`     | Size of the folder in bytes                 | Number - 0 decimal places
| `_ctime`    | Creation time of the folder                 | Date - include time, **Use same time for all collaborators**
| `_mtime`    | Last modified time of the folder            | Date - include time, **Use same time for all collaborators**
| `_items`    | Number of items in the folder               | Number - 0 decimal places
| `_parent`   | Parent folder of this folder                | Link to record - this table

#### Files Table

Only use this smaller table when the [mediaMetadata setting](#configsettingsfilesmediametadata) is disabled.

| Field       | Description                                 | Type
| ---         | ---                                         | ---
| `_path`     | Will store the full path of the file        | Single line text
| `_size`     | Size of the file in bytes                   | Number - 0 decimal places
| `_ctime`    | Creation time of the file                   | Date - include time, **Use same time for all collaborators**
| `_mtime`    | Last modified time of the file              | Date - include time, **Use same time for all collaborators**
| `_parent`   | Parent folder of this file                  | Link to record - folders table

### File Table with Metadata

All the fields of the in the [files table](#files-table) plus:

| Field               | Description                                 | Type
| ---                 | ---                                         | ---
| `_duration`         | Duration of the media                       | Number - 2 decimal places
| `_video`            | Whether the media has a video stream        | checkbox
| `_videoStill`       | Whether the file is a image                 | checkbox
| `_videoCodec`       | Video codec of the media                    | Single line text
| `_videoWidth`       | Width of the media                          | Number - 0 decimal places
| `_videoHeight`      | Height of the media                         | Number - 0 decimal places
| `_videoFormat`      | Pixel format of the media                   | Single line text
| `_videoAlpha`       | Whether the media has an alpha channel      | checkbox
| `_videoFPS`         | Frames Per Second of the video, 0 for stills| Number - 2 decimal places
| `_videoBitRate`     | Bit rate of the video (b)                   | Number - 0 decimal places
| `_audio`            | Whether the media has a audio stream        | checkbox
| `_audioCodec`       | Audio codec of the media                    | Single line text
| `_audioSampleRate`  | Sample rate of the audio (KHz)              | Number - 0 decimal places
| `_audioChannels`    | Number of channels of audio                 | Number - 0 decimal places
| `_audioBitRate`     | Bit rate of the audio (b)                   | Number - 0 decimal places


### Field Notes

The fields are named like this so it's clear which fields are entered via the tracker, you can easily do other fields that reference these values, but do not edit the values in these columns or they will just get overwritten/deleted.

If all the records are being updated every time, it is likely because of a mismatch on the created/modified time - ensure the **Use same time for all collaborators** option is selected on these fields and you can try setting the timezone to match the computer which is running the script. _Despite sending them as UTC strings, AirTable is a bit funky on how it handles the dates._

## Command Line Options

Get the latest options by running `tracker -h` which will return something like:

```
CLI File Content Tracking

Options:
  -V, --version          output the version number
  -c, --config <path>    config file path (if none specified template will be created)
  -d, --dry-run          will do everything apart from updating AirTable
  -l, --logging <level>  set the logging level
  -w, --wipe-cache       clear the metadata cache
  -h, --help             display help for command
```

### Config Option: -c, --config <path>

When you run `tracker` for the first time without a path option it will generate the `config.json` file which you will then need to update. Once updated run the command again with `tracker -c config.json`, for more info on the contents of the config file, check the [section on config files](#config-file).

### Dry-run Option: -d, --dry-run

Inherently, it's nice to know this isn't going to wreak havoc on your AirTable, so if you run `tracker -c config.json -d` it will show you what it's going to do but stop short of modifying the AirTable. It will still run on at the [frequency you specify](#configsettingsfilesfrequency). You will need to run with a (#logging-option--l---logging) logging level of verbose to see all the details.

### Logging Option: -l, --logging

Specify one of the following levels of logging:

1. error
2. warn
3. info
4. http (default)
5. verbose
6. debug
7. silly

### Wipe Cache: -w, --wipe-cache

There's a local cache built up in `./db` of the metadata of files so they don't have to keep getting queried via FFMpeg which is a tad computationally expensive, but if you need to rescan all files run with this option. Files will already be automatically scanned if they change size or the modified time changed.

# Config File

Create the default config as [described above](#config-option--c---config-), which will generate something like this:
```json
{
  "settings": {
    "files": {
      "dir": "~/",
      "frequency": 30,
      "rules": {
        "dirs": {
          "includes": [],
          "excludes": []
        },
        "files": {
          "includes": [],
          "excludes": [
            "/\\.DS_Store$/"
          ]
        }
      }
    },
    "airtable": {
      "api": "",
      "base": "",
      "foldersID": "",
      "filesID": "",
      "view": "API"
    }
  }
}
```

In general, leave all the parameters in the JSON file, there is some error handling if they're not present but probably for the best to leave everything in there.

## config.settings

### config.settings.files

This section relates to all the local file scanning. The script in general builds up a list of all the files and folders and here you get a bit of control over that.

#### config.settings.files.dir

The directory to recursively search through, _e.g._
```json
"dir": "/Volumes/Suite/"
```

#### config.settings.files.frequency

How often the directory is scanned (in seconds), _e.g. if you wanted to scan it every minute:_
```json
"frequency": 60
```

You can also set this to `0` and the script will only run once - this is intended if you want to automate this as part of a cron job.

#### config.settings.files.rules

So I'll be honest, this is the only slightly faffy bit... but it definitely beats entering them as command-line arguments that was my first plan. The thought process here is you're filtering the paths of the files and folders will get included in the tables which are pushed to AirTable.

Whatever you specify in these fields the script will still have to traverse all of the folders in the directory - if you have specified a pattern like `/.*\/Delivery\/.*/` which would match any folder with `/Delivery/` in the path, by the nature of the task you're still going to have to search through every folder.

Now the bit that makes it faffy is you have to stringify JS regex patterns, which usually just means escaping the slashes - a handy one to make use of [the dry run option](#dry-run-option--d---dry-run). __Note you're matching the entire path of the file/folder in both `dirs` & `files`__.

_For example, in the example below we're limiting the folders which are stored on AirTable to only be ones that include `/05 Delivery/` somewhere in the path, then only including specific image sequence TIFFs:_

```json
"rules": {
  "dirs": {
    "includes": [
      "/.*\/05 Delivery\/.*/"
    ],
    "excludes": []
  },
  "files": {
    "includes": [
      "/[_.]v\\d{2,3}\\.tif/",
      "/[_.]0{4,5}\\.tif/"
    ],
    "excludes": []
  }
}
```

#### config.settings.files.mediaMetadata

Whether you want to get all the metadata for the media, which will scrape all the fields in the (files with metadata table)[#file-table-with-metadata], _e.g._

```json
"mediaMetadata": true
```

### config.settings.airtable

Once you've [setup your AirTable](#airtable-setup), please configure the following settings:

#### config.settings.airtable.api

Get your API key from the [AirTable Tokens page](https://airtable.com/create/tokens), it will need the following permissions:
- data.records:read
- data.records:write
 
 Plus access to the workspace where your base is located.

 #### config.settings.airtable.base

 You'll need to go to the [API page for your base](https://airtable.com/developers/web/api/introduction) and get the base ID and enter this here, _e.g._

 ```json
"base": "app**************"
 ```

#### config.settings.airtable.foldersID / filesID

  Technically you can just put the folders table name here, but on [the same page as the base ID](https://airtable.com/developers/web/api/introduction) you can get the IDs for the tables, then if the table names get updated later it won't affect the script, _e.g._

  ```json
"foldersID": "tbl**************",
"filesID": "tbl**************"
  ```

#### config.settings.airtable.view

This is the view the script compares the local file list against - e.g. you could technically store other items in the table and filter them out in this view; you could have multiple scripts all writing into the same table and filter them out per view _(this might be better achieved by writing to multiple tables)._

This defaults to a view called `API`:

```json
"view": "API"
```

## Development

Clone the repo and run it locally like so:

```sh
git clone https://github.com/garethnunns/cli-content-tracker.git
cd cli-content-tracker
npm install
npm link
tracker
```

_You can always `npm unlink` this later._

Very welcome to pull requests!