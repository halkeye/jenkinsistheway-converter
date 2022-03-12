import YAML from 'js-yaml';

import stream from 'stream';
import fs from 'fs/promises'
import path from 'path';
import https from 'https';
import {promisify} from 'util';
import Pluralize from 'pluralize';

import {keyize, dontIndent, escapeRegExp, findNested, convertAdocToMarkdown} from './utils.mjs';

const QUOTE_MARKER = 'QUOTEQUOTEQUOTEQUOTEETOUQ'

const finished = promisify(stream.finished);

const rootDir = '../jenkins-is-the-way/src'
const imagesDir = path.join(rootDir, 'images', 'user-story')
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
		continue; // FIXME
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
				industries: item.frontmatter.industry ? [item.frontmatter.industry] : [],
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
			try {
				const filename = await downloadToFile(image.replace('image:', ''), path.join(imagesDir, path.basename(image.replace('image:', ''))));
				item.adoc = item.adoc.replace(image, 'image:/images/user-story/' + path.basename(filename));
			} catch (e) {
				console.error(e);
				continue;
			}
		}

		const elementorData = JSON.parse(item.frontmatter._elementor_data);
		const testimonal = findNested(elementorData, (item) => item.settings.testimonial_content);
		items[itemKey] = {
			...(items[itemKey] || {}),
			adoc: item.adoc,
			title: item.title,
			date: new Date(Date.parse(item.pubDate)).toISOString(),
			post_name: item.post_name.trim(),
		};

		items[itemKey].adoc = items[itemKey].adoc.replace(/\n\*Results:\s+\*/, '\n*Results:*')

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

			if (!items[itemKey].sub_title && line.startsWith('== ')) {
				items[itemKey].sub_title = line.substring(3).trim();
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

			if (!items[itemKey].image && line.startsWith('image:/images/user-story/')) {
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
				const key = keyize(header);
				if (!items[itemKey][key]) {
					items[itemKey][key] = remainder
					return false;
				}
			}

			if (pluralFields.includes(header)) {
				const key = keyize(Pluralize(header));
				const results = remainder.split(remainder.includes(';') ? ';' : ',').map(str => str.trim()).filter(Boolean)
				if (!items[itemKey][key]) {
					items[itemKey][key] = results
					return false;
				}
			}

			return true;
		}).join("\n").replace(/\n\n\n/g, "\n")

		const quote = {}
		if (testimonal) {
			const quoteRegex = new RegExp([
				escapeRegExp(testimonal.settings.testimonial_content.replace(/<b>/g, '*').replace(/<\/b>/g, '*').trim()),
				escapeRegExp("image:/images/user-story/" + path.basename(testimonal.settings.testimonial_image.url).trim()),
				"\\[image,width=[0-9]+,height=[0-9]+\\]",
				escapeRegExp(testimonal.settings.testimonial_name.trim()),
				escapeRegExp(testimonal.settings.testimonial_job.trim()),
			].join("\\s*"));

			quote.from = testimonal.settings.testimonial_name.trim()
			quote.content = testimonal.settings.testimonial_content.trim().replace(/<b>/g, '').replace(/<\/b>/g, '').replace('“', '"').replace('”', '"')
			quote.image = path.basename(testimonal.settings.testimonial_image.url)

			items[itemKey].adoc = items[itemKey].adoc.replace(quoteRegex, `\n\n${QUOTE_MARKER}\n\n`);
		}

		items[itemKey].adoc = items[itemKey].adoc
			.replace(/[\u2014]/g, "--")        // emdash
			.replace(/[\u2022]/g, "*")         // bullet
			.replace(/[\u2018\u2019]/g, "'")   // smart single quotes
			.replace(/[\u201C\u201D]/g, '"');  // smart double quotes

		items[itemKey].adoc = items[itemKey].adoc.split('\n').map(line => line.replace(/^\s*TIME Center CI\/CD solution\s*$/, '== TIME Center CI/CD solution')).join('\n')

		items[itemKey].md = await convertAdocToMarkdown(items[itemKey].adoc).then(md => md.toString('utf8')).then(
			md => md.replace(QUOTE_MARKER, `<Testimonal from="${quote.from}" image="./${quote.image}">${quote.content}</Testimonal>`)
		);

		items[itemKey].adoc = items[itemKey].adoc.replace(QUOTE_MARKER, dontIndent(`
			[.testimonal]
			[quote, "${quote.from}"]
			${quote.content}
			image:/images/user-story/${quote.image}[image,width=200,height=200]
		`));
	}
}

for (const staticImage of ['https://jenkinsistheway.io/wp-content/uploads/2020/04/Jenkins-is-the-Way-768x911.png']) {
	const filename = path.join(imagesDir, path.basename(staticImage));
	await fs.mkdir(imagesDir, {recursive: true})
	await downloadToFile(staticImage, filename);
}

for (const [_, {md, adoc, ...item}] of Object.entries(items)) {
	if (!md) {continue;}
	await fs.mkdir(contentDir, {recursive: true})

	const body = `---\n${YAML.dump(item)}---\n${md}`;
	const filename = path.join(contentDir, item.post_name + '.mdx')
	await fs.writeFile(filename, body);
}
