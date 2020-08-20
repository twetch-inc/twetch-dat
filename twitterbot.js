require('dotenv').config();
const Twetch = require('@twetch/sdk');
const Twit = require('twit');
const TonicPow = require('tonicpow-js');
var options = { clientIdentifier: process.env.clientIdentifier };
const twetch = new Twetch(options);
var twAccount = createWallet(process.env.privKey);
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const tcoRegex = RegExp('https:\/\/t.co\/[a-zA-Z0-9\-\.]{10}', 'g');
auth();

console.log(twetch.wallet.address());
const twitURL = process.env.twitterURL;
var T = new Twit({
	consumer_key: process.env.consumer_key,
	consumer_secret: process.env.consumer_secret,
	access_token: process.env.access_token,
	access_token_secret: process.env.access_token_secret,
	timeout_ms: 60 * 1000, // optional HTTP request timeout to apply to all requests.
	strictSSL: false, // optional - requires SSL certificates to be valid.
});
async function auth() {
	const token = await twetch.authenticate({ create: true });
	console.log({ token });
}
function createWallet(key) {
	let opts = options;
	opts.privateKey = key;
	let wallet = new twetch.wallet.constructor(opts);
	var twInstance = new Twetch(opts);
	wallet.feeb = 0.5;
	twInstance.wallet = wallet;
	twInstance.wallet.backup();
	return twInstance;
}
async function post(instance, content, reply, twData, url, branch, filesURL, tweet, hide) {
	let response = await instance.buildAndPublish('twetch/post@0.0.1', {
		bContent: `${content}${branch}${filesURL}`,
		mapReply: reply,
		mapTwdata: twData,
		mapUrl: url,
		payParams: { tweetFromTwetch: tweet, hideTweetFromTwetchLink: hide },
	});
	return response.txid;
}
var stream = T.stream('statuses/filter', { track: process.env.trackPhrase });
stream.on('tweet', function (tweet) {
	if (tweet.display_text_range !== undefined) {
		let trimTweet = tweet.text.slice(tweet.display_text_range[0], tweet.display_text_range[1]);
		if (!trimTweet.includes(process.env.trackPhrase)) {
			return;
		}
	}
	// listen for tweet that matches track phrase
	let twtToArchive = tweet.in_reply_to_status_id_str;
	let tweetLink = `${twitURL}${tweet.in_reply_to_screen_name}/status/${twtToArchive}`;
	getTweetContent(twtToArchive, tweet.id_str, tweet.user.screen_name, tweetLink);
});

function decodeHtmlCharCodes(s) { 
    const dom = new JSDOM(`<!DOCTYPE html><p>${s}</p>`);
    return dom.window.document.querySelector("p").textContent;
}

function getURL(tco, arr) {
    let obj = arr.find(o => o.url === tco);
    if (obj && obj.expanded_url !== undefined && obj.media_url_https === undefined){
        return obj.expanded_url;
    }
    else {
        return tco;
    }
}

function getPhotos(arr) {
	let photos = [];
	for (let i=0;i<arr.length;i++) {
		if (arr[i].media_url_https !== undefined) {
			photos.push(arr[i].media_url_https);
		}
	}
	return photos;
}

async function getTweetContent(status, replyTweet, requestor, twToTwtch) {
	console.log({ status, replyTweet });
	// get content of tweet (replied to) to twetch
	T.get('statuses/show/:id', { id: status, tweet_mode: 'extended' }, async function (
		err,
		data,
		response
	) {
		if (response.statusCode === 200) {
			if (data.full_text.includes("I twetched it for you") || data.full_text.includes("I branched it for you")){
				return;
			}
			let match, content = data.full_text, photos = [];
			if (data.entities !== undefined) {
				let linkArr = data.entities.urls;
				while ((match = tcoRegex.exec(data.full_text)) != null){
					let i = 0;
					content = content.replace(match[i], getURL(match[i], linkArr));
					i++;
				}
			}
			if (data.extended_entities !== undefined) {
				let photoArr = data.extended_entities.media;
				while ((match = tcoRegex.exec(data.full_text)) != null){
					let i = 0;
					content = content.replace(match[i], '');
					i++;
				}
				photos = getPhotos(photoArr);
			}
			let txid;
			let twObj = {
				created_at: data.created_at,
				twt_id: data.id_str.toString(),
				text: decodeHtmlCharCodes(content),
				media: photos,
				user: {
					name: data.user.name,
					screen_name: data.user.screen_name,
					created_at: data.user.created_at,
					twt_id: data.user.id.toString(),
					profile_image_url: data.user.profile_image_url,
				},
			};
			try {
				let prevTwetch = await twetch.query(`{allPosts(filter: {mapUrl: {includes: "${twToTwtch}"}}) {nodes {transaction}}}`);
				let posts = prevTwetch.allPosts.nodes;
				if (posts.length > 0){
					txid = await post(twAccount, ' ', '', '', '', process.env.twetchURL+posts[0].transaction, '');
					T.get('search/tweets', {q: `https://twetch.app/t/${posts[0].transaction}`, count: 1}, async function (err, result, data){
						console.log('result statuses: ', result.statuses.length);
						if (txid) {
							if (result.statuses.length > 0){
								await resTweet(requestor, replyTweet, ``,
								`${twitURL}${result.statuses[0].user.screen_name}/status/${result.statuses[0].id_str}`);
							}
							else {
								await resTweet(requestor, replyTweet, `https://twetch.app/t/${posts[0].transaction}`,``, true);
							}
						}
					})
				}
				else {
					txid = await post(twAccount, ' ', '', JSON.stringify(twObj), twToTwtch, '', '');
					if (txid) {
						await resTweet(requestor, replyTweet, `https://twetch.app/t/${txid}`);
				 	}
				}
			} catch (e) {
				console.log(`Error while posting to twetch. `, e);
			}
		} else {
			console.log(
				`Error while fetching tweet: ${twToTwtch}, did not archive Tweet on Twetch. `,
				err
			);
			return;
		}
	});
}
async function tncPowLink(url) {
	let res;
	await TonicPow.init(process.env.tonicPowToken);
	try {
		res = await TonicPow.createLink({ target_url: url });
	} catch (e) {
		console.log(
			`Error while fetching TonicPow short link for url ${url}, failed to reply on Twitter. `,
			e
		);
		return;
	}
	return res.short_link_url;
}
async function resTweet(requestor, reply, url, rt, branch) {
	console.log({ reply });

	let twetchURL;
	if (process.env.useTncPow === '1') {
		twetchURL = await tncPowLink(url);
	} else {
		twetchURL = url;
	}
	let twtContent = `OK @${requestor} I ${branch === true ? 'branched' : 'twetched'} it for you

This post is now forever on the blockchain

Link to post 👇
${twetchURL}`;
	if (rt){
		twtContent = rt;
	}

	return new Promise((resolve, reject) => {
		T.post('statuses/update', { status: twtContent, in_reply_to_status_id: reply }, function (
			err,
			data,
			response
		) {
			if (response && response.statusCode === 200) {
				console.log(
					`Tweet successfully posted at: ${process.env.twitterURL}${process.env.twetchDat}/status/${data.id_str}`
				);
				return resolve();
			} else {
				console.log(
					`Error while posting reply to Tweet ${process.env.twitterURL}${requestor}/status/${reply}, failed to reply to @${requestor} on Twitter. `,
					err
				);

				return reject(err);
			}
		});
	});
}