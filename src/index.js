require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const deepl = require('deepl-node');
const fasttext = require('fasttext');
const path = require('path');

const authKey = process.env.DEEPL;
const translator = new deepl.Translator(authKey);
const classifier = new fasttext.Classifier();

const modelPath = path.join(__dirname, '..', 'lid.176.ftz');

classifier.loadModel(modelPath, function (err) {
    if (err) {
        console.error('Error loading model:', err);
        return;
    }
    console.log('FastText model loaded successfully.');
});

function detectLanguage(text) {
  return new Promise((resolve, reject) => {
    classifier.predict(text, 1, function (err, res) {
      if (err) {
        console.error('Prediction error:', err);
        reject(err);
        return;
      }
      const prediction = res[0];
      const langCode = prediction.label.replace('__label__', '');
      resolve(langCode);
    });
  });
};

const {
  LIKES,
  RETWEETS,
  REPLIES,
  API,
  TWITTER,
  REGEX,
} = require("./constants");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: [] },
});

const tweetEmbed = (
  authorName,
  authorTag,
  authorIconURL,
  tweetURL,
  tweetContent,
  translated,
  tweetLikes,
  tweetRetweets,
  tweetReplies,
  linkPosterUsername,
  linkPosterIconURL,
  image
) =>
  new EmbedBuilder()
    .setColor(0x0099ff)
    .setAuthor({
      name: `${authorName} (@${authorTag})`,
      url: `${TWITTER}${authorTag}`,
      iconURL: authorIconURL,
    })
    .setTitle(translated ? 'Tweet (Translated)' : 'Tweet')
    .setURL(tweetURL)
    .setDescription(tweetContent)
    .addFields({
      name: `${LIKES} ${tweetLikes}    ${RETWEETS} ${tweetRetweets}    ${REPLIES} ${tweetReplies}`,
      value: ` `,
    })
    .setImage(image)
    .setFooter({
      text: `Posted by ${linkPosterUsername}`,
      iconURL: linkPosterIconURL,
    });

const imageEmbed = (tweetURL, imageURL) =>
  new EmbedBuilder().setURL(tweetURL).setImage(imageURL);

client.on("ready", (client) => {
  console.log(`${client.user.tag} is ready!`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const serverUser = await getServerUser(message);
  const { nickname, avatar } = getNicknameAndAvatar(serverUser);

  const matches = message.content.match(REGEX);
  if (matches && matches[3]) {
    console.log(`Tweet ID: ${matches[3]}`);
    const data = await fetchData(matches[3]);

    if (!data) return;
    console.log("Tweet data obtained");
    console.log(data);

    const { text, translated, imageURLS, videoURLS, gifURLS } =
      await processTweetData(data);

    const linkPosterContent = message.content.replace(matches[0], "").trim();
    console.log(`Tweet text: ${text}`);
    console.log(`Tweet images`);
    console.table(imageURLS);
    console.log(`Tweet videos`);
    console.table(videoURLS);
    console.log(`Tweet gifs`);
    console.table(gifURLS);

    const mainEmbed = createMainTweetEmbed(
      message,
      data,
      nickname,
      avatar,
      text,
      translated,
      imageURLS[0]
    );

    console.log("Main embed created!");

    const imageEmbeds = createImageEmbeds(data.tweetURL, imageURLS.slice(1));

    if (linkPosterContent.length > 0) {
      message.suppressEmbeds(true);
      await message.reply({ embeds: [mainEmbed, ...imageEmbeds], repliedUser: false });
    } else {
      deleteMessage(message);
      await message.channel.send({ embeds: [mainEmbed, ...imageEmbeds] });
    }

    await sendMediaIfAvailable(
      message.channel,
      videoURLS[0],
      "Getting gif data via API call to"
    );
    await sendMediaIfAvailable(
      message.channel,
      gifURLS[0],
      "Getting gif data via API call to"
    );
  }
});

function deleteMessage(message) {
  message.delete();
}

async function getServerUser(message) {
  return await message.guild.members.fetch(message.author);
}

function getNicknameAndAvatar(serverUser) {
  const nickname = serverUser.nickname;
  const avatar = serverUser.displayAvatarURL();
  return { nickname, avatar };
}

async function fetchData(tweetID) {
  const response = await fetch(`${API}${tweetID}`);
  return response.status >= 400 ? null : await response.json();
}

async function processTweetData(data) {
  const { text, lang } = data;
  const translated = lang === "en" ? false : true;

  const imageURLS = getMediaURLsByType(data.media_extended, "image");
  const videoURLS = getMediaURLsByType(data.media_extended, "video");
  const gifURLS = getMediaURLsByType(data.media_extended, "gif");

  const response = { text, translated, imageURLS, videoURLS, gifURLS };

  if (!translated) return response;

  try {
    const translation = await translator.translateText(text, null, 'EN-US', {
      splitSentences: 'nonewlines',
    });
    const translatedText = translation.text;
    response.text = translatedText;
    console.log(`Translated tweetContent: ${translatedText}`);
  } catch (translationError) {
    console.error('Error translating text:', translationError);
    response.translated = false;
  }
  return response;
}


function getMediaURLsByType(mediaList, type) {
  return mediaList
    .filter((media) => media.type === type)
    .map((item) => item.url);
}

function createMainTweetEmbed(
  message,
  data,
  nickname,
  avatar,
  text,
  translated,
  imageURL
) {
  return tweetEmbed(
    data.user_name,
    data.user_screen_name,
    data.user_profile_image_url,
    data.tweetURL,
    text,
    translated,
    data.likes,
    data.retweets,
    data.replies,
    nickname
      ? `${nickname} (${message.author.displayName})`
      : message.author.displayName,
    avatar,
    imageURL
  );
}

function createImageEmbeds(tweetURL, imageURLs) {
  return imageURLs.map((imageURL) => imageEmbed(tweetURL, imageURL));
}

async function sendMediaIfAvailable(channel, mediaURL, logMessage) {
  if (mediaURL) {
    console.log(`${logMessage} ${mediaURL}`);
    const response = await fetch(mediaURL, { method: "HEAD" });
    const size = parseInt(
      Object.fromEntries(response.headers.entries())["content-length"]
    );
    await channel.send(size > 8000000 ? mediaURL : { files: [mediaURL] });
  }
}

client.login(process.env.TOKEN);
