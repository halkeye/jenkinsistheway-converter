import YAML from 'js-yaml';
import YAML2 from 'yaml';

import stream from 'stream';
import fs from 'fs/promises'
import path from 'path';
import https from 'https';
import {promisify} from 'util';
import Pluralize from 'pluralize';

import {keyize, escapeRegExp, findNested, convertAdocToMarkdown} from './utils.mjs';

const finished = promisify(stream.finished);

const rootDir = '../jenkins-is-the-way/src'
const imagesDir = path.join(rootDir, 'images')
const contentDir = path.join(rootDir, 'user-story')

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
				map: {
					location: item.frontmatter.location,
					industries: item.frontmatter.industry ? [item.frontmatter.industry] : [],
					name: item.frontmatter.name.trim(),
					latitude: item.frontmatter._wpgmp_metabox_latitude,
					longitude: item.frontmatter._wpgmp_metabox_longitude,
				}
			}
			continue;
		}
		if (!item.adoc) {continue;}
		const baseDir = path.join(contentDir, item.post_name)
		await fs.mkdir(baseDir, {recursive: true})

		const itemKey = item.post_name
		const images = new Set(item.adoc.match(/image:https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Zá0-9()]{1,6}\b([-a-záA-Z0-9()@:%_\+.~#?&//=]*)/g))
		for (const image of Array.from(images)) {
			try {
				const filename = await downloadToFile(image.replace('image:', ''), path.join(baseDir, path.basename(image.replace('image:', ''))));
				item.adoc = item.adoc.replace(image, 'image:./' + path.basename(filename));
			} catch (e) {
				console.error(e);
				continue;
			}
		}
		item.adoc = item.adoc.split('\n').map(line => line.replace(/^\s*TIME Center CI\/CD solution\s*$/, '== TIME Center CI/CD solution')).join('\n')

		//if (item.post_name.trim() === 'tymit') {
		//  console.log(item.adoc);
		//}

		const elementorData = JSON.parse(item.frontmatter._elementor_data);
		const testimonal = findNested(elementorData, (item) => item.settings.testimonial_content);
		items[itemKey] = {
			...(items[itemKey] || {}),
			metadata: {},
			body: {},
			tmp: {
				adoc: item.adoc,
			},
			title: item.title,
			date: new Date(Date.parse(item.pubDate)).toISOString(),
			post_name: item.post_name.trim(),
		};

		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(/\n\*Results:\s+\*/, '\n*Results:*')

		// Fix a single "Program URL:" line which had an extra forced line break
		// post_name == 'to-space'
		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(/\S*\+\n\n/, '\n\n');

		// fix a random new line in to-cook-almost-everything-in-devops-world
		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(/,\s*Spoke with colleagues and peers/, ', Spoke with colleagues and peers')

		// fix a random new line in to-truly-automate-everything
		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(/Kubernetes,\s*Linux/, 'Kubernetes, Linux')


		let weAreDone = false;
		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(/\+\n/, '').split("\n").filter(line => {
			if (weAreDone) {
				// keep the remaining lines
				return true;
			}

			let noFormattingLine = line.replace(/\*/g, '').replace(/_/g, '');

			if (!items[itemKey].body.sub_title && line.startsWith('== ')) {
				items[itemKey].body.sub_title = line.substring(3).trim();
				return false;
			}

			if (!items[itemKey].metadata.sub_title && line.startsWith('== ')) {
				items[itemKey].metadata.sub_title = line.substring(3).trim();
				return false;
			}

			if (!items[itemKey].submitted_by && line.toLowerCase().includes('submitted by jenkins user')) {
				items[itemKey].submitted_by = line.replace(/_/g, '').substring('=== Submitted By Jenkins User'.length).trim()
				return false;
			}

			if (!items[itemKey].tag_line && line.startsWith('==== ')) {
				items[itemKey].tag_line = line.substring(6).trim().replace(/^\*/g, '').replace(/\*$/g, '')
				return false;
			}

			if (!items[itemKey].image && line.startsWith('image:./')) {
				items[itemKey].image = line.substring(6).trim().replace(/\[.*/, '')
				return false;
			}

			if (line.startsWith('=')) {
				weAreDone = true;
				return true; // we are keeping it
			}

			const fieldReplacements = {
				"Project URL": "Project Website",
				"Project website": "Project Website",
				"Project": "Project Website",
				"Program URL": "Project Website",

				"KP Labs Team": "Team Members",
				"Arm Teammates": "Team Members",
				"IAM Robotics Team": "Team Members",
				"Team": "Team Members",
				"Team members": "Team Members",
				"Team Member": "Team Members",
				"Graylog team members": "Team Members",
				"Telstra Team": "Team Members",
				"Camunda Team Members": "Team Members",
				"Moogsoft Team": "Team Members",

				"Build Tools": "Build Tool",

				"Version Control": "Version Control System",

				"Project funding": "Project Funding",
				"Funding": "Project Funding",
				"Funded by": "Project Funding",
			}

			const fields = {
				'Organization': {type: 'singular', section: 'metadata'},
				'Company': {type: 'singular', section: 'metadata'},
				'Company website': {type: 'singular', section: 'metadata'},
				'Project Website': {type: 'singular', section: 'metadata'},
				'Summary': {type: 'singular', section: 'metadata'},
				'Project Funding': {type: 'singular', section: 'metadata'},
				'Funded By': {type: 'singular', section: 'metadata'},
				'Industry': {type: 'plural', section: 'metadata'},
				'Programming Language': {type: 'plural', section: 'metadata'},
				'Platform': {type: 'plural', section: 'metadata'},
				'Version Control System': {type: 'plural', section: 'metadata'},
				'Build Tool': {type: 'plural', section: 'metadata'},
				'Community Support': {type: 'plural', section: 'metadata'},
				'Team Members': {type: 'plural', section: 'metadata'},
				'Team': {type: 'plural', section: 'metadata'},
				'Plugin': {type: 'plural', section: 'metadata'},

				'Background': {type: 'singular', section: 'body'},
				'Goals': {type: 'singular', section: 'body'},
				//'Solution & Results': {type: 'singular', section: 'body'},
			}


			let [header, ...remainder] = noFormattingLine.trim().split(':')
			remainder = remainder.join(':').trim();
			header = header.trim();
			if (fieldReplacements[header]) {
				header = fieldReplacements[header];
			}

			if (fields[header]) {
				const field = fields[header];
				if (field.type === 'singular') {
					const key = keyize(header);
					if (!items[itemKey][field.section][key]) {
						items[itemKey][field.section][key] = remainder
						return false;
					}
				} else if (field.type === 'plural') {
					const key = keyize(Pluralize(header));
					const results = remainder.split(remainder.includes(';') ? ';' : ',').map(str => str.trim()).filter(Boolean)
					if (!items[itemKey][field.section][key]) {
						items[itemKey][field.section][key] = results
						return false;
					}
				}
			}

			return true;
		}).join("\n").replace(/\n\n\n/g, "\n")

		if (testimonal) {
			const quoteRegex = new RegExp([
				escapeRegExp(testimonal.settings.testimonial_content.replace(/<b>/g, '*').replace(/<\/b>/g, '*').trim()),
				escapeRegExp("image:./" + path.basename(testimonal.settings.testimonial_image.url).trim()),
				"\\[image,width=[0-9]+,height=[0-9]+\\]",
				escapeRegExp(testimonal.settings.testimonial_name.trim()),
				escapeRegExp(testimonal.settings.testimonial_job.trim()),
			].join("\\s*"));

			items[itemKey].quotes = [{
				from: testimonal.settings.testimonial_name.trim(),
				content: testimonal.settings.testimonial_content.trim().replace(/<b>/g, '').replace(/<\/b>/g, '').replace(/“/g, '"').replace(/”/g, '"').replace(/"/g, ''),
				image: path.basename(testimonal.settings.testimonial_image.url),
			}]

			items[itemKey].tmp.adoc = items[itemKey].tmp.adoc.replace(quoteRegex, '');
		}

		items[itemKey].tmp.adoc = items[itemKey].tmp.adoc
			.replace(/[\u2014]/g, "--")        // emdash
			.replace(/[\u2022]/g, "*")         // bullet
			.replace(/[\u2018\u2019]/g, "'")   // smart single quotes
			.replace(/[\u201C\u201D]/g, '"');  // smart double quotes

		items[itemKey].body.remaining = await convertAdocToMarkdown(items[itemKey].tmp.adoc).then(md => md.toString('utf8').trim());

		for (const section of ['body', 'metadata']) {
			for (const [key, val] of Object.entries(items[itemKey][section])) {
				if (Array.isArray(val)) {
					items[itemKey][section][key] = await Promise.all(val.map(str => convertAdocToMarkdown(str).then(md => md.toString('utf8').trim())))
				} else {
					items[itemKey][section][key] = await convertAdocToMarkdown(val).then(md => md.toString('utf8').trim());
				}
			}
		}
	}
}

for (const staticImage of [
	'https://jenkinsistheway.io/wp-content/uploads/2020/04/Jenkins-is-the-Way-768x911.png',
	'https://jenkinsistheway.io/wp-content/uploads/2021/11/Screen-Shot-2021-11-18-at-10.18.48-AM.png',
	'https://jenkinsistheway.io/wp-content/uploads/2021/09/jenkins_map_pin-180x180-1.png',
	'https://jenkinsistheway.io/wp-content/uploads/2021/09/jenkins_map_pin2-e1634173081372.png',
]) {
	const filename = path.join(imagesDir, path.basename(staticImage));
	await fs.mkdir(imagesDir, {recursive: true})
	await downloadToFile(staticImage, filename);
}

for (const item of Object.values(items)) {
	if (!item.post_name) {
		console.log('missing post_name', item);
		continue;
	}
	if (!item.body) {
		console.log('missing', item);
		continue;
	}
	await fs.mkdir(contentDir, {recursive: true})
	const filename = path.join(contentDir, item.post_name, 'index.yaml')
	delete item.tmp;
	await fs.writeFile(filename, YAML2.stringify(item));
}
