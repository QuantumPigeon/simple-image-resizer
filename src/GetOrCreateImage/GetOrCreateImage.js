'use strict'

const AWS = require('aws-xray-sdk').captureAWS(require('aws-sdk'))
const Sharp = require('sharp')
const { parse } = require('querystring')

const S3 = new AWS.S3()

const GetOrCreateImage = async event => {
  console.info("GetOrCreateImage handler")

  const {
    cf: {
      request: {
        origin: {
          s3: {
            domainName
          }
        },
        querystring,
        uri
      },
      response,
      response: {
        status
      }
    }
  } = event.Records[0]

  console.info(JSON.stringify(response, null, 4))

  if (!['403', '404'].includes(status)) return response

  console.info("domainName\n" + domainName)
  console.info("uri\n" + uri)

  let { width, height, sourceImage, nextExtension, scaling } = parse(querystring)
  // const [bucket] = domainName.match(/.+(?=\.s3\.amazonaws\.com)/i)
  const [bucket] = domainName.match(/.+(?=\.s3\..*\.amazonaws\.com)/i)

  console.info("bucket\n" + bucket)

  console.info("sourceImage\n" + sourceImage)

  let contentType = 'image/' + nextExtension

  console.info("contentType\n" + contentType)

  let key = uri.replace(/^\//, '')
  console.info("key\n" + key)
  const sourceKey = sourceImage.replace(/^\//, '')
  console.info("sourceKey\n" + sourceKey)

  height = parseInt(height, 10)
  width = parseInt(width, 10)

  if (!width || !height) return response

  return S3.getObject({ Bucket: bucket, Key: sourceKey })
    .promise()
    .then(imageObj => {
      let resizedImage
      const errorMessage = `Error while resizing "${sourceKey}" to "${key}":`

      console.info(JSON.stringify(imageObj.Metadata, null, 4))

      if (nextExtension == '') {
        nextExtension = imageObj.Metadata["content-type"].replace(/^(image\/)/,'');
        console.info("nextExtension\n" + nextExtension)
        contentType = 'image/' + nextExtension
        console.info("contentType\n" + contentType)
        key = key + "." + nextExtension
        console.info("key\n" + key)
      }

      let isAnimated = (nextExtension == "gif") ? true : false;
      console.info("isAnimated \n" + isAnimated)

      // Required try/catch because Sharp.catch() doesn't seem to actually catch anything. 
      try {
        resizedImage = Sharp(imageObj.Body, { animated: isAnimated })
          .resize(width, height, {
            withoutEnlargement: true,
            fit: scaling,
          })
          .toFormat(nextExtension, {
            /**
             * @see https://sharp.pixelplumbing.com/api-output#webp for a list of options.
             */
            quality: 95
          })
          .toBuffer()
          .catch(error => {
            throw new Error(`${errorMessage} ${error}`)
          })
      } catch(error) {
        throw new Error(`${errorMessage} ${error}`)
      }
      return resizedImage
    })
    .then(async imageBuffer => {
      await S3.putObject({
        Body: imageBuffer,
        Bucket: bucket,
        ContentType: contentType,
        Key: key,
        StorageClass: 'STANDARD'
      })
        .promise()
        .catch(error => {
          throw new Error(`Error while putting resized image '${uri}' into bucket: ${error}`)
        })

      return {
        ...response,
        status: 200,
        statusDescription: 'Found',
        body: imageBuffer.toString('base64'),
        bodyEncoding: 'base64',
        headers: {
          ...response.headers,
          'content-type': [{ key: 'Content-Type', value: contentType }]
        }
      }
    })
    .catch(error => {
      const errorMessage = `Error while getting source image object "${sourceKey}": ${error}`

      return {
        ...response,
        status: 404,
        statusDescription: 'Not Found',
        body: errorMessage,
        bodyEncoding: 'text',
        headers: {
          ...response.headers,
          'content-type': [{ key: 'Content-Type', value: 'text/plain' }]
        }
      }
    })
}

module.exports = GetOrCreateImage
