import YAML from 'js-yaml';

import stream from 'stream';
import fs from 'fs/promises'
import path from 'path';
import https from 'https';
import {promisify} from 'util';
import Pluralize from 'pluralize';

// from https://stackoverflow.com/a/2970667
function camelize(str) {
	return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
		if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
		return index === 0 ? match.toLowerCase() : match.toUpperCase();
	});
}

function dontIndent(str) {
	return ('' + str).replace(/^[ \t]+/mg, '');
}

function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function findNested(data, fn) {
	for (const item of data) {
		if (fn(item)) {
			return item;
		}
		if (item.elements) {
			const a = findNested(item.elements, fn)
			if (a != null) {
				return a;
			}
			continue;
		}
	}
	return null;
}

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

		const elementorData = JSON.parse(item.frontmatter._elementor_data);
		const testimonal = findNested(elementorData, (item) => item.settings.testimonial_content);
		items[itemKey] = {
			...(items[itemKey] || {}),
			layout: 'jenkinsistheway',
			adoc: item.adoc,
			title: item.title,
			date: new Date(Date.parse(item.pubDate)).toISOString(),
			post_name: item.post_name.trim(),
		};

		// Fix a single "Program URL:" line which had an extra forced line break
		// post_name == 'to-space'
		items[itemKey].adoc = items[itemKey].adoc.replace(/\S*\+\n\n/, '\n\n');

		// fix a random new line in to-cook-almost-everything-in-devops-world
		items[itemKey].adoc = items[itemKey].adoc.replace(/,\s*Spoke with colleagues and peers/, ', Spoke with colleagues and peers')

		// fix a random new line in to-truly-automate-everything
		items[itemKey].adoc = items[itemKey].adoc.replace(/Kubernetes,\s*Linux/, 'Kubernetes, Linux')

		let weAreDone = false;
		items[itemKey].adoc = items[itemKey].adoc.replace(/\+\n/, '').split("\n").filter(line => {
			if (weAreDone) {
				// keep the remaining lines
				return true;
			}

			let noFormattingLine = line.replace(/\*/g, '').replace(/_/g, '');

			if (!items[itemKey].subTitle && line.startsWith('== ')) {
				items[itemKey].subTitle = line.substring(3).trim();
				return false;
			}

			if (!items[itemKey].submittedBy && line.toLowerCase().includes('submitted by jenkins user')) {
				items[itemKey].submittedBy = line.replace(/_/g, '').substring('=== Submitted By Jenkins User'.length).trim()
				return false;
			}

			if (!items[itemKey].tagLine && line.startsWith('==== ')) {
				items[itemKey].tagLine = line.substring(6).trim().replace(/^\*/g, '').replace(/\*$/g, '')
				return false;
			}

			if (!items[itemKey].image && line.startsWith('image:/images/jenkinsistheway/')) {
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
			const singularFields = ['Organization', 'Company', 'Company website', 'Project Website', 'Summary', "Project Funding", "Funded By"]
			const pluralFields = ['Industry', 'Programming Language', 'Platform', 'Version Control System', 'Build Tool', 'Community Support', 'Team Members', 'Team', 'Plugin']


			let [header, ...remainder] = noFormattingLine.trim().split(':')
			remainder = remainder.join(':').trim();
			header = header.trim();
			if (fieldReplacements[header]) {
				header = fieldReplacements[header];
			}

			if (singularFields.includes(header)) {
				const key = camelize(header);
				if (!items[itemKey][key]) {
					items[itemKey][key] = remainder
					return false;
				}
			}

			if (pluralFields.includes(header)) {
				const key = camelize(Pluralize(header));
				const results = remainder.split(remainder.includes(';') ? ';' : ',').map(str => str.trim()).filter(Boolean)
				if (!items[itemKey][key]) {
					items[itemKey][key] = results
					return false;
				}
			}

			return true;
		}).join("\n").replace(/\n\n\n/g, "\n")

		if (testimonal) {
			const quoteRegex = new RegExp([
				escapeRegExp(testimonal.settings.testimonial_content.replace(/<b>/g, '*').replace(/<\/b>/g, '*')),
				escapeRegExp("image:/images/jenkinsistheway/" + path.basename(testimonal.settings.testimonial_image.url)),
				"\\[image,width=[0-9]+,height=[0-9]+\\]",
				escapeRegExp(testimonal.settings.testimonial_name),
				escapeRegExp(testimonal.settings.testimonial_job),
			].join("\\s*"));
			items[itemKey].adoc = items[itemKey].adoc.replace(quoteRegex, "\n\n" + dontIndent(`

			[.testimonal]
			[quote, "${testimonal.settings.testimonial_name}"]
			${testimonal.settings.testimonial_content.replace(/<b>/g, '').replace(/<\/b>/g, '')}
			image:/images/jenkinsistheway/${path.basename(testimonal.settings.testimonial_image.url)}[image,width=200,height=200]
			`) + "\n\n");

			if (item.post_name === 'to-simplify-things-for-devops-world') {
				console.log(quoteRegex, items[itemKey]);
			}
		}


		items[itemKey].adoc = items[itemKey].adoc
			.replace(/[\u2014]/g, "--")        // emdash
			.replace(/[\u2022]/g, "*")         // bullet
			.replace(/[\u2018\u2019]/g, "'")   // smart single quotes
			.replace(/[\u201C\u201D]/g, '"');  // smart double quotes

		items[itemKey].adoc = items[itemKey].adoc.split('\n').map(line => line.replace(/^\s*TIME Center CI\/CD solution\s*$/, '== TIME Center CI/CD solution')).join('\n')
	}
}


for (const [_, {adoc, ...item}] of Object.entries(items)) {
	if (!adoc) {continue;}
	await fs.mkdir(contentDir, {recursive: true})
	const body = `---\n${YAML.dump(item)}---\n${adoc}`;
	const filename = path.join(contentDir, item.post_name + '.adoc')
	if (!adoc.trim().startsWith('==')) {
		console.log(filename, body);
	}
	await fs.writeFile(filename, body);
}
