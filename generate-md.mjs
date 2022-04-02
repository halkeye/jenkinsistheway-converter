import YAML2 from 'yaml';

import stream from 'stream';
import fs from 'fs/promises'
import path from 'path';
import https from 'https';
import {promisify} from 'util';
import Pluralize from 'pluralize';
import {remark} from 'remark';
import {visitParents} from 'unist-util-visit-parents';
import {toMarkdown} from 'mdast-util-to-markdown';

import {keyize, escapeRegExp, findNested, dontIndent, cleanString} from './utils.mjs';

const finished = promisify(stream.finished);

const rootDir = '../jenkins-is-the-way/src'
const imagesDir = path.join(rootDir, 'images')
const contentDir = path.join(rootDir, 'user-story')

const data = await fs.readFile('./jenkinsistheway-md.json', 'utf8').then(str => JSON.parse(str));

const exists = async (filename) => fs.stat(filename).then(() => true).catch(err => {
	if (err.code === "ENOENT") {
		return false;
	}
	throw err
});

const FIELDS = {
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
	'Team Members': {type: 'plural', section: 'metadata', key: 'team_members'},
	'Teammates': {type: 'plural', section: 'metadata', key: 'team_members'},
	'Team': {type: 'plural', section: 'metadata'},
	'Plugin': {type: 'plural', section: 'metadata'},

	'Background': {type: 'singular', section: 'body'},
	'Goals': {type: 'singular', section: 'body'},
	'Solution & Results': {type: 'singular', section: 'body', key: 'solution'},
	'Solution and Results': {type: 'singular', section: 'body', key: 'solution'},
	'Solution': {type: 'singular', section: 'body', key: 'solution'},
	'References': {type: 'singular', section: 'body'},
	'Results': {type: 'singular', section: 'body'},
	'Challenge': {type: 'singular', section: 'body'},
	// FIXME - should get merged into existing section - solution
	// if section already exists, merge header and body and append
	'Lab Book': {type: 'singular', section: 'body'},
	'Deployer': {type: 'singular', section: 'body'},
}

async function retrieveImages(story) {
	const remainders = await remark()
		.use(function pullOutImages() {
			return (tree, _file) => {
				return visitParents(tree, "image", function (node, ancestors) {
					const parent = ancestors[ancestors.length - 1];
					parent.children.splice(parent.children.indexOf(node), 1)

					story.image = path.basename(node.url);

					story.tmp.downloads.push({
						src: node.url,
						dest: path.basename(node.url)
					})
				})
			}
		})
		.process(story.tmp.md);

	story.tmp.md = String(remainders)
}


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

const items = {}

const posts = data
	.filter(item => item.post_type === 'post')
	.filter(item => item.post_type === 'post')
	.filter(item => !item.title.toLowerCase().endsWith(' template'))

const caseStudies = posts.filter(item => item?.category?._ === "Case Studies" || item?.title?.includes('Jenkins Case Study:'))
const maps = posts.filter(item => item?.category?._ === "map")

for (const item of caseStudies) {
	console.log('Skipping Case Study', item.post_name); // FIXME
}

for (const item of maps) {
	if (!item.frontmatter['story link']) {
		console.log('skipping map as it has no story linkt', item.post_name)
		continue;
	}
	const mapKey = item.frontmatter['story link']
		.trim()
		.replace(
			"https://jenkinsistheway.io/user-story/to-focus-on-your-code/",
			"https://jenkinsistheway.io/user-story/jenkins-is-the-way-to-focus-on-your-code/"
		).replace(
			'https://jenkinsistheway.io/user-story/',
			''
		).replace(/\/$/, '')

	if (mapKey.includes('https://')) {
		console.log('skipping', mapKey);
		continue;
	}
	items[mapKey] = {
		...(items[mapKey] || {}),
		map: {
			location: item.frontmatter.location,
			industries: item.frontmatter.industry ? [item.frontmatter.industry.trim()] : [],
			name: item.frontmatter.name.trim(),
			latitude: item.frontmatter._wpgmp_metabox_latitude,
			longitude: item.frontmatter._wpgmp_metabox_longitude,
		}
	}
}

for (const item of posts.filter(item => !maps.includes(item) && !caseStudies.includes(item))) {
	const itemKey = item.post_name.trim()

	if (!item.md) {
		console.log('no body for', item.post_name || item.title || item)
		continue;
	}

	const story = {
		...(items[itemKey] || {}),
		metadata: {},
		body: {},
		tmp: {
			downloads: [],
			md: item.md,
		},
		title: item.title,
		date: new Date(Date.parse(item.pubDate)).toISOString(),
		post_name: itemKey,
	};
	items[itemKey] = story;

	const baseDir = path.join(contentDir, item.post_name)
	await fs.mkdir(baseDir, {recursive: true})

	const elementorData = JSON.parse(item.frontmatter._elementor_data);
	const testimonal = findNested(elementorData, (item) => item.settings.testimonial_content);

	story.tmp.md = cleanString(story.tmp.md)

	if (testimonal) {
		const testimonial_content = cleanString(testimonal.settings.testimonial_content.trim())
			.replace(/^<b>(.*)<\/b>$/m, '$1')
			.replace(/<b>/g, '*')
			.replace(/<\/b>/g, '*')
			.replace(/^\*\*/m, '')
			.replace(/\*\*$/m, '')
			.trim()

		const quoteRegex = new RegExp([
			'\\**' + escapeRegExp(testimonial_content) + '\\**',
			"\\!\\[(.*?)\\]\\(" + escapeRegExp(testimonal.settings.testimonial_image.url.trim() + ")"),
			escapeRegExp(testimonal.settings.testimonial_name.trim()),
			escapeRegExp(testimonal.settings.testimonial_job.trim()),
		].join("\\s*"), 'm');

		story.quotes = [{
			from: testimonal.settings.testimonial_name.trim(),
			content: testimonial_content.replace(/^"(.*)"$/m, '$1'),
			image: './quote.png',
		}]

		story.tmp.md = story.tmp.md.replace(quoteRegex, '');
		story.tmp.downloads.push({
			src: testimonal.settings.testimonial_image.url,
			dest: 'quote.png'
		})
	}

	story.tmp.md = story.tmp.md.replaceAll('&#x20;', ' ');
	story.tmp.md = story.tmp.md.replaceAll('<!-- -->', '')

	story.tmp.md = story.tmp.md.replace(/\*\*\.\s*$/m, '.**') // period after bold gets moved inside

	// find any headers that are cased worng, or have space between : and * type things
	for (const header of Object.keys(FIELDS)) {
		story.tmp.md = story.tmp.md.replace(
			new RegExp(`^\\*\\*${escapeRegExp(header)}:\\s+(.*?)\\*\\*\\s*$`, 'mi'),
			`**${header}:** $1`
		)
		story.tmp.md = story.tmp.md.replace(
			new RegExp(`^${escapeRegExp(header)}:\\s+`, 'mi'),
			`**${header}:** `
		)
	}

	story.tmp.md = story.tmp.md.replace('**Solution** **& Results:**', '**Solution & Results:** $1')

	story.tmp.md = story.tmp.md.replace('***Organization:***', '**Organization:**')
	story.tmp.md = story.tmp.md.replace('\\*\\*\\*Programming Language: \\*\\*\\*', '**Programming Language:**')
	story.tmp.md = story.tmp.md.replace('***Platform***\\*:\\*', '**Platform:**')
	story.tmp.md = story.tmp.md.replace('***Version Control System:***', '**Version Control System:**')
	story.tmp.md = story.tmp.md.replace('***Build Tool:***', '**Build Tool:**')
	story.tmp.md = story.tmp.md.replace('\\*\\*\\*Community Support: \\*\\*\\*', '**Community Support:**')


	await retrieveImages(story)

	story.tmp.md = story.tmp.md.replaceAll('&#x20;', ' ');
	story.tmp.md = story.tmp.md.replaceAll('<!-- -->', '')
	story.tmp.md = story.tmp.md.replace(
		' **Organization:** IBM **Industry:** infrastructure and software development **Programming Language:** Node.js, Python, Ruby **Platform**: Docker or Kubernetes, Linux, MacOS **Version Control System:** GitHub, GitLab **Build Tool:** Ant, Rake **Community Support:** Spoke with colleagues and peers',
		dontIndent(`
		**Organization:** IBM

		**Industry:** infrastructure and software development

		**Programming Language:** Node.js, Python, Ruby

		**Platform**: Docker or Kubernetes, Linux, MacOS

		**Version Control System:** GitHub, GitLab

		**Build Tool:** Ant, Rake

		**Community Support:** Spoke with colleagues and peers
	`))

	// jenkins-case-study-preply
	story.tmp.md = story.tmp.md.replace(
		'##### *By Amet Umerov*',
		'## Submitted by Jenkins User Amet Umerov'
	)

	// jenkins-case-study-graylog
	story.tmp.md = story.tmp.md.replace(
		'##### *By Donald Morton and Alyssa Tong*',
		'## Submitted by jenkins user Donald Morton and Alyssa Tong'
	)

	// jenkins-case-study-gainsight
	story.tmp.md = story.tmp.md.replace(
		'##### *By Prudviraj Pentakota and Alyssa Tong*',
		'## Submitted by jenkins user Prudviraj Pentakota and Alyssa Tong'
	)

	// tymit
	story.tmp.md = story.tmp.md.replace(
		'##### *By Tymit Technology Team and Alyssa Tong*',
		'## Submitted by jenkins user Tymit Technology Team and Alyssa Tong'
	)

	// tymit
	story.tmp.md = story.tmp.md.replace(
		'##### *By Alejandro Alvarez Vazquez and Alyssa Tong*',
		'## Submitted by jenkins user Alejandro Alvarez Vazquez and Alyssa Tong'
	)

	story.tmp.md = story.tmp.md.replace(
		'##### *By* *Jon Brohauge and Alyssa Tong*',
		'## Submitted by jenkins user Jon Brohauge and Alyssa Tong'
	)

	// to-make-better-recommendations
	story.tmp.md = story.tmp.md.replace(
		'When a recommendation engine has to respond to hundreds of thousands of requests per second, there is no room for development downtime.\n',
		'### When a recommendation engine has to respond to hundreds of thousands of requests per second, there is no room for development downtime.\n'
	)

	// post_name: 'to-automate-the-future-for-developers',
	story.tmp.md = story.tmp.md.replace(
		'**Community Support:  J**enkins',
		'**Community Support:** Jenkins'
	)

	// to-modernize-healthcare
	story.tmp.md = story.tmp.md.replace(
		'**Programming Language: Java,** Node.js, Python\n',
		'**Programming Language:** Java, Node.js, Python\n',
	)

	// to-achieve-speed-correctness
	story.tmp.md = story.tmp.md.replace(
		'**Programming Language: PHP,** Python',
		'**Programming Language:** PHP, Python'
	)

	// post_name: 'to-develop-cloud-at-scale',
	story.tmp.md = story.tmp.md.replace(
		'**Programming Language: Java, Node.js,** Python',
		'**Programming Language:** Java, Node.js, Python'
	)


	// post_name: 'to-amazing-automation',
	story.tmp.md = story.tmp.md.replace(
		'\\*\\*Industry: \\*\\* Semiconductor \n',
		'**Industry:** Semiconductor\n'
	)

	// post_name: 'to-automate-the-future-for-developers',
	story.tmp.md = story.tmp.md.replace(
		/\*\*Community Support:\s*J\*\*enkins/,
		'**Community Support:** Jenkins'
	)

	//   post_name: 'to-automate-almost-anything-in-an-enterprise',
	story.tmp.md = story.tmp.md.replace(
		'**Programming Language: Java,**',
		'**Programming Language:** Java,'
	)

	//   post_name: 'to-keep-the-world-spinning',
	story.tmp.md = story.tmp.md.replace(
		' **Organization:** IBM, <https://www.ibm.com/mx-es> **Industry:** Cloud and Storage **Programming Language:** Python **Platform**: Linux **Version Control System:** GitHub **Build Tool:** Scripting **Community Support:** Jenkins.io websites & blogs',
		dontIndent(`
		**Organization:** IBM, <https://www.ibm.com/mx-es> 

		**Industry:** Cloud and Storage 

		**Programming Language:** Python 

		**Platform**: Linux 

		**Version Control System:** GitHub 

		**Build Tool:** Scripting 

		**Community Support:** Jenkins.io websites & blogs',
		`)
	)

	//  post_name: 'to-automate-the-lives-of-all-programmers-who-want-a-quality-product',
	story.tmp.md = story.tmp.md.replace(
		/\&\#\x\2\0\;\*\*Organization:\*\*\sIBM,\s\<https:\/\/www.ibm.com\/mx-es\>\s\*\*Industry:\*\*\sCloud\sand\sStorage\s\*\*Programming\sLanguage:\*\*\sPython\s\*\*Platform\*\*:\sLinux\s\*\*Version\sControl\sSystem:\*\*\sGitHub\s\*\*Build\sTool:\*\*\sScripting\s\*\*Community\sSupport:\*\*\sJenkins.io\swebsites\s\&\sblogs/,
		dontIndent(`
			**Organization:** Sincrovia Soluções Tecnológicas,  <https://sincrovia.com.br/> 

			**Industry:** Logistics 

			**Programming Language:** Java, Node.js 

			**Platform**: Android, iOS, Docker or Kubernetes, Linux 

			**Version Control System:** GitHub 

			**Build Tool:** Maven 

			**Teammates:** Luís Felipe Costa, Software Engineer and Guimarães Teixeira, CEO, Sincrovia Soluções Tecnológicas
		`)
	)

	// post_name: 'to-automate-the-lives-of-all-programmers-who-want-a-quality-product',
	story.tmp.md = story.tmp.md.replace(
		' **Organization:** Sincrovia Soluções Tecnológicas,  <https://sincrovia.com.br/> **Industry:** Logistics **Programming Language:** Java, Node.js **Platform**: Android, iOS, Docker or Kubernetes, Linux **Version Control System:** GitHub **Build Tool:** Maven **Teammates:** Luís Felipe Costa, Software Engineer and Guimarães Teixeira, CEO, Sincrovia Soluções Tecnológicas',
		dontIndent(`
		**Organization:** Sincrovia Soluções Tecnológicas,  <https://sincrovia.com.br/> 

		**Industry:** Logistics 

		**Programming Language:** Java, Node.js 

		**Platform**: Android, iOS, Docker or Kubernetes, Linux 

		**Version Control System:** GitHub 

		**Build Tool:** Maven 

		**Teammates:** Luís Felipe Costa, Software Engineer and Guimarães Teixeira, CEO, Sincrovia Soluções Tecnológicas'
		`)
	)

	// to-achieve-a-stable-cicd-enterprise-solution
	story.tmp.md = story.tmp.md.split('\n').map(line => line.replace(/^\s*TIME Center CI\/CD solution\s*$/, '# TIME Center CI/CD solution')).join('\n')

	// Fix a single "Program URL:" line which had an extra forced line break
	// post_name == 'to-space'
	story.tmp.md = story.tmp.md.replace(/\S*\+\n\n/, '\n\n');

	// fix a random new line in to-cook-almost-everything-in-devops-world
	story.tmp.md = story.tmp.md.replace(/,\s*Spoke with colleagues and peers/, ', Spoke with colleagues and peers')

	// fix a random new line in to-truly-automate-everything
	story.tmp.md = story.tmp.md.replace(/Kubernetes,\s*Linux/, 'Kubernetes, Linux')

	// d4science-amps-up-their-scientific-research-platform-with-ci-cd-powered-by-jenkins
	story.tmp.md = story.tmp.md.replace('**REFERENCES:**\n', '*References:* ')
	story.tmp.md = story.tmp.md.replace(
		'**SUMMARY: D4Science, supporting scientific communities and promoting open science practices by serving 11,000+ registered users in 45 countries, introduced a new delivery pipeline replacing their pre-existing build platform.**',
		'**Summary:** D4Science, supporting scientific communities and promoting open science practices by serving 11,000+ registered users in 45 countries, introduced a new delivery pipeline replacing their pre-existing build platform.',
	)
	story.tmp.md = story.tmp.md.replace(
		'**CHALLENGE: D4Science needed a cost-effective way to build and release their software framework (gCube) able to support multi-project releases at scale.**',
		'**Challenge:** D4Science needed a cost-effective way to build and release their software framework (gCube) able to support multi-project releases at scale.'
	)
	story.tmp.md = story.tmp.md.replace(
		'**SOLUTION: A Continuous Integration/Continuous Delivery (CI/CD) pipeline, scalable, easy to maintain and upgrade at a minimal cost, that represents an innovative approach to software delivering.  **',
		'**Solution:** A Continuous Integration/Continuous Delivery (CI/CD) pipeline, scalable, easy to maintain and upgrade at a minimal cost, that represents an innovative approach to software delivering.'
	)

	// to-do-ci-cd-right
	story.tmp.md = story.tmp.md.replace(
		'### **[Read the full case study to learn more.](https://jenkinsistheway.io/case-studies/jenkins-case-study-avoris-travel/)**',
		'**[Read the full case study to learn more.](https://jenkinsistheway.io/case-studies/jenkins-case-study-avoris-travel/)**',
	)

	// meh, remove the entire quote it'll be populated later
	story.tmp.md = story.tmp.md.replace(
		/\*\*.Jenkins pipelines made everything simple . even a complex requirement . which helps us reach our deliverables in less time...*Nitish Chandu Oggu/,
		''
	)

	const remainders = await remark()
		.use(function () {
			return (tree, _file) => {
				tree.children = tree.children.filter(child => {
					if (child.type === 'heading') {
						const line = toMarkdown({type: 'paragraph', children: child.children}, {emphasis: ''}).replaceAll('&#x20;', '').trim();
						if (child.depth == 1) {
							story.body.sub_title = line
							return false;
						}
						if (!story.tag_line && (child.depth == 4 || child.depth == 3)) {
							story.tag_line = line.replace(/^\*+(.*?)\*+$/, '$1') // FIXME maybe handle two stars?
							return false;
						}
						if (!story.submitted_by && line.toLowerCase().includes('submitted by jenkins user')) {
							story.submitted_by = line.replace(/^\*+(.*?)\*+$/, '$1').substring('Submitted By Jenkins User'.length).trim()
							return false;
						}
					}
					return true;
				});

				if (story.post_name == 'tymit') {
					console.log(story.tmp.md);
					die();
				}

				const nodesToRemove = [];
				let lastHeader = '';

				for (let i = 0; i < tree.children.length; i++) {
					let child = tree.children[i];
					if (child.type === 'paragraph') {
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

							"Goal": "Goals",

							"RESULTS": "Results",
						}


						if (child.children[0].type === 'strong') {
							// key value pair
							let header = child?.children[0]?.children[0]?.value?.trim()?.replace(/:$/, '')?.trim() || lastHeader;
							if (!header) {
								console.log(child.children[0].children);
								die();
							}
							if (fieldReplacements[header]) {
								header = fieldReplacements[header];
							}

							let line = toMarkdown({type: 'paragraph', children: child.children.slice(1)}, {emphasis: '', strong: ''})

							if (!FIELDS[header]) {
								if (lastHeader) {
									header = lastHeader;
								} else {
									continue;
								}
							}
							lastHeader = header;
							// probably a continuation
							while (tree.children[i + 1] && tree.children[i + 1].children && tree.children[i + 1].children[0]?.type !== 'strong') {
								line = line + toMarkdown(tree.children[i + 1]).trim();
								nodesToRemove.push(tree.children[i + 1]);
								i++;
							}

							line = line.trim().replaceAll('&#x20;', ' ').replace(/^\*+(.*?)\*+$/, '$1').trim();

							const field = FIELDS[header];
							if (field.type === 'singular') {
								const key = field.key || keyize(header);
								if (story[field.section][key] && story[field.section][key].trim() == line.trim()) {
									// duplicated line, just throw it away
									nodesToRemove.push(child);
									continue;
								} else if (story[field.section][key]) {
									// it already has that section, so appened it
									story[field.section][key] = story[field.section][key] + '\n' + line
									nodesToRemove.push(child);
									continue;
								} else {
									story[field.section][key] = line
									nodesToRemove.push(child);
									continue;
								}
							} else if (field.type === 'plural') {
								const key = field.key || keyize(Pluralize(header));
								const results = line.split(line.includes(';') ? ';' : ',').map(str => str.trim()).filter(Boolean)
								if (!story[field.section][key]) {
									story[field.section][key] = results
									nodesToRemove.push(child);
									continue;
								}
							}
						}
					}
				}
				tree.children = tree.children.filter(child => !nodesToRemove.includes(child))
			}
		}).process(story.tmp.md);

	story.tmp.md = String(remainders)
	if (story.tmp.md) {
		console.log(story);
		process.exit(1)
	}
//}
//for (const [itemKey, story] of Object.entries(items)) {
	if (!story.post_name) {
		console.log('missing post_name', itemKey, story);
		continue;
	}

	if (!story.body) {
		console.log('missing body for', story.post_name);
		continue;
	}

	await fs.mkdir(contentDir, {recursive: true})
	for (const download of story.tmp.downloads) {
		await downloadToFile(download.src, path.join(contentDir, story.post_name, download.dest));
	}

	delete story.tmp;
	await fs.writeFile(path.join(contentDir, story.post_name, 'index.yaml'), '---\n' + YAML2.stringify(story));
}

console.log('Done writing')
