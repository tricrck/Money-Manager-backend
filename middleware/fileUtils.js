const fs = require('fs-extra');
const Logger = require('./Logger')

/**
 * Read contents of file
 * @param {string} path
 * @returns {string}
 */
async function readTextFile(path) {
  try {
    var data = await fs.readFile(path)
    return String(data)
  } catch (error) {
    Logger.error(`[FileUtils] ReadTextFile error ${error}`)
    return ''
  }
}
module.exports.readTextFile = readTextFile
