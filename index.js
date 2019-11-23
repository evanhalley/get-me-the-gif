const fs = require('fs');
const request = require("superagent");
const chromium = require('chrome-aws-lambda');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');

const VIDEO_THUMBNAIL_PREFIX = 'https://pbs.twimg.com/tweet_video_thumb/';
const VIDEO_URL_PREFIX = 'https://video.twimg.com/tweet_video/';
const TMP_FOLDER = '/tmp';

ffmpeg.setFfmpegPath(ffmpegPath);

async function extractUrlToGif(tweetUrl) {
    // Instantiate a Chrome browser
    let videoUrl = null;
    let browser = null;
    let page = null;

    try {
        //let chrome = await getChrome();
        //console.log(`Retrieve a Chrome instance @ ${chrome.endpoint}`);

        browser = await chromium.puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
        });
        console.log('Chrome launched...');
        //console.log(`Retrieve a Chrome instance @ ${browser.}`);

        // connect to the browser via a websocket using Puppeteer
        //browser = await puppeteer.connect({
         //   browserWSEndpoint: chrome.endpoint
        //});
        console.log('Connection to the browser successful...');
        console.log(`Extracting video from ${tweetUrl}...`);

        page = await browser.newPage();
        await page.setRequestInterception(true);
        
        page.on('request', request => {

            if (request.url().startsWith(VIDEO_THUMBNAIL_PREFIX) && request.url().endsWith('.jpg')) {
                let thumbnailUrl = request.url();
                console.log(`Found the thumbnail URL ${thumbnailUrl}...`)
                let assetId = thumbnailUrl.replace(VIDEO_THUMBNAIL_PREFIX, '')
                    .replace('.jpg', '');
                videoUrl = VIDEO_URL_PREFIX + assetId + '.mp4';
                console.log(`Video URL ${videoUrl}...`);
            }
            request.continue();
        });
        await page.goto(tweetUrl);
    } catch (e) {
        console.error('Error extracting GIF url from tweet', e);
    } finally {
        if (page) await page.close();        
        if (browser) await browser.close();
    }
    return videoUrl;
}

function downloadMp4(urlToMp4) {
    return new Promise((resolve, reject) => {

        try {
            let filename = `${new Date().getTime()}.mp4`;
            console.log(`Downloading ${urlToMp4} to ${TMP_FOLDER}/${filename}...`)
            let file = fs.createWriteStream(`${TMP_FOLDER}/${filename}`);
            file.on('close', () => {
                resolve(`/tmp/${filename}`);  
            });
            request.get(urlToMp4).pipe(file);
        } catch (err) {
            reject(err);
        }
    });
}

function convertMp4ToGif(mp4Filename) {
    return new Promise((resolve, reject) => {
        let fileKey = mp4Filename.replace(`${TMP_FOLDER}/`, '')
            .replace('.mp4', '');
        let gifFilename = `${TMP_FOLDER}/${fileKey}.gif`;
        console.log(`Converting ${mp4Filename} to ${gifFilename}...`);

        ffmpeg(mp4Filename)
            .on('end', () => {
                console.log('Conversion complete');
                resolve(gifFilename);
            })
            .on('error', err => {
                console.error('Error during conversion', err);
                reject(err);
            })
            .save(gifFilename);
    });
}

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

	// CORS headers so we can make cross domain requests to our Lambda
    let headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
        "access-control-allow-methods": "GET"
    };

	// Bail out if there's no params
    if (!event.queryStringParameters || !event.queryStringParameters.url) {
        return {
            statusCode: 400,
            headers,
            body: 'You should specify a url'
        };
    }

    // Get the target URL from params
    try {
        let tweetUrl = event.queryStringParameters.url;
        let urlToMp4 = await extractUrlToGif(tweetUrl);
        let mp4Filename = await downloadMp4(urlToMp4);
        let gifFilename = await convertMp4ToGif(mp4Filename);
        headers['Content-Type'] = 'text/html';

        let body = 
            `<img src="data:image/gif;base64,${new Buffer(fs.readFileSync(gifFilename)).toString('base64')}" />
             <p><b>Instructions:</b></p>
             <p>1) Right Click</p>
             <p>2) Save As...</p>
             <p>3) Profit!</p>`;

        return {
            statusCode: 200,
            headers,
            body: body
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            headers,
            body: 'Yikes!'
        };
    }
};