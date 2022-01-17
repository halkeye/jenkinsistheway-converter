import YAML from 'js-yaml';

import stream from 'stream';
import fs from 'fs/promises'
import path from 'path';
import https from 'https';
import {promisify} from 'util';

const finished = promisify(stream.finished);


const rootDir = '../jenkins.io/content'
const imagesDir = path.join(rootDir, 'images', 'jenkinsistheway')
const contentDir = path.join(rootDir, 'jenkinsistheway')

const data = await fs.readFile('./jenkinsistheway.json', 'utf8').then(str => JSON.parse(str));

const exists = async (filename) => fs.stat(filename).then(() => true).catch(err => {
	if (err.code === "ENOENT") {
		return false;
	}
	throw err
});

async function downloadToFile(url, filename) {
	if (await exists(filename)) {
		return filename.replace(/á/g, 'a');
	}
	const fd = await fs.open(filename, 'w');
	const stream = fd.createWriteStream();

	const response = await new Promise((resolve, reject) => {
		https.get(url, function (res) {
			const {statusCode} = res;
			if (statusCode !== 200) {
				return reject(new Error(`unable to fetch ${url} to ${filename}: ${res.body}`));
			}
			resolve(res);
		});
	})
	response.pipe(stream);
	await finished(stream);
	return filename.replace(/á/g, 'a');
}

const items = {}
for (const item of data.item) {
	if (['page', 'nav_menu_item', 'elementor_library'].includes(item.post_type)) {
		// handled manually in html/jenkins.io
		// aka not data
		continue;
	}

	if (item.post_type === 'attachment') {
		const filename = path.join(imagesDir, path.basename(item.attachment_url));
		await fs.mkdir(imagesDir, {recursive: true})
		await downloadToFile(item.attachment_url, filename);
		continue;
	}
	if (item.post_type === 'post') {
		if (item.title.toLowerCase().endsWith(' template')) {
			continue;
		}
		if (item?.category?._ === "map") {
			if (!item.frontmatter['story link']) {
				continue;
			}
			const itemKey = item.frontmatter['story link'].replace('https://jenkinsistheway.io/user-story/', '').replace(/\/$/, '')
			items[itemKey] = {
				...(items[itemKey] || {}),
				location: item.frontmatter.location,
				industry: item.frontmatter.industry,
				name: item.frontmatter.name.trim(),
				latitude: item.frontmatter._wpgmp_metabox_latitude,
				longitude: item.frontmatter._wpgmp_metabox_longitude,
			}
			continue;
		}
		if (!item.adoc) {continue;}
		const itemKey = item.post_name
		const images = new Set(item.adoc.match(/image:https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Zá0-9()]{1,6}\b([-a-záA-Z0-9()@:%_\+.~#?&//=]*)/g))
		for (const image of Array.from(images)) {
			await fs.mkdir(imagesDir, {recursive: true})
			const filename = await downloadToFile(image.replace('image:', ''), path.join(imagesDir, path.basename(image.replace('image:', ''))));
			item.adoc = item.adoc.replace(image, 'image:/images/jenkinsistheway/' + path.basename(filename));
		}
		items[itemKey] = {
			...(items[itemKey] || {}),
			layout: 'simplepage',
			adoc: item.adoc,
			title: item.title,
			date: new Date(Date.parse(item.pubDate)).toISOString(),
			post_name: item.post_name.trim(),
		};
		continue;
	}

	console.log(item.post_id, item.post_name, item.post_type);
}


for (const [_, {adoc, ...item}] of Object.entries(items)) {
	if (!adoc) {continue;}
	await fs.mkdir(contentDir, {recursive: true})
	const body = `---\n${YAML.dump(item)}---\n${adoc}`;
	await fs.writeFile(path.join(contentDir, item.post_name + '.adoc'), body);
}
