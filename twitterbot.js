require('dotenv').config();
const Twetch = require('@twetch/sdk');
const Twit = require('twit');
const TonicPow = require('tonicpow-js');
var options = { clientIdentifier: process.env.clientIdentifier };
const twetch = new Twetch(options);
var twAccount = createWallet(process.env.privKey);
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
	// listen for tweet that matches track phrase
	let twtToArchive = tweet.in_reply_to_status_id_str;
	let tweetLink = `${twitURL}${tweet.in_reply_to_screen_name}/status/${twtToArchive}`;
	getTweetContent(twtToArchive, tweet.id_str, `Tweet from @${tweet.user.screen_name}`, tweetLink);
});
async function getTweetContent(status, replyTweet, header, twToTwtch) {
	// get content of tweet (replied to) to twetch
	T.get('statuses/show/:id', { id: status, tweet_mode: 'extended' }, async function (
		err,
		data,
		response
	) {
		if (response.statusCode === 200) {
			let tweetContent = `${data.full_text}

${twToTwtch}`,
				txid;
			let twObj = {
				created_at: data.created_at,
				twt_id: data.id.toString(),
				text: data.full_text,
				user: {
					name: data.user.name,
					screen_name: data.user.screen_name,
					created_at: data.user.created_at,
					twt_id: data.user.id.toString(),
					profile_image_url: data.user.profile_image_url,
				},
			};
			try {
				txid = await post(twAccount, tweetContent, '', JSON.stringify(twObj), twToTwtch, '');
			} catch (e) {
				console.log(`Error while posting to twetch. `, e);
			}
			resTweet(data.user.screen_name, replyTweet, `https://twetch.app/t/${txid}`);
		} else {
			console.log(
				`Error while fetching tweet: ${twtToTwtch}, did not archive Tweet on Twetch. `,
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
async function resTweet(requestor, reply, url) {
	let twetchURL;
	if (process.env.useTncPow === '1') {
		twetchURL = await tncPowLink(url);
	} else {
		twetchURL = url;
	}
	let twtContent = `OK @${requestor} I twetched it for you 🌟

This post is now forever on the blockchain

Link to post 👇
${twetchURL}`;
	T.post('statuses/update', { status: twtContent, in_reply_to_status_id: reply }, function (
		err,
		data,
		response
	) {
		if (response.statusCode === 200) {
			console.log(
				`Tweet successfully posted at: ${process.env.twitterURL}${process.env.twetchDat}/status/${data.id_str}`
			);
		} else {
			console.log(
				`Error while posting reply to Tweet ${process.env.twitterURL}${requestor}/status/${reply}, failed to reply to @${requestor} on Twitter. `,
				err
			);
			return;
		}
	});
}
