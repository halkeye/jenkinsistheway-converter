import {Parser} from 'xml2js';
import {unserialize} from 'php-serialize'
import {spawn} from 'child_process';
import fs from 'fs/promises';

async function convertBody(body) {
	return new Promise(function (resolve, reject) {
		const command = 'pandoc';
		const args = [
			'--wrap=none',
			'-f',
			'html',
			'-t',
			'asciidoc',
			'--atx-headers',
			'-o',
			'-',
			'-',
		];
		// console.log(`${command} ${args.map((a) => `"${a}"`).join(' ')}`);
		const p = spawn(
			command, args, {
			encoding: 'utf8',
			env: {...process.env, LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8'},
			stdio: ['pipe', 'pipe', 'pipe'],
		},
		);
		p.once('error', reject);
		p.once('exit', () => resolve({stderr, stdout, }));

		let stderr = '';
		p.stderr.on('data', (data) => stderr += data);
		p.stderr.on('end', () => {
			if (stderr.trim()) {
				// reject(stderr.trim());
			}
		});
		let stdout = '';
		p.stdout.on('data', (data) => stdout += data);
		p.stdin.write(body);
		p.stdin.end();
	});
}

const parser = new Parser();
const xml = await parser.parseStringPromise(
	await fs.readFile("./jenkins.WordPress.2021-12-22.xml")
);
const config = {
	author: [],
	category: [],
	tag: [],
	term: [],
	item: [],
};

for (const section of ['wp:author', 'wp:category', 'wp:tag', 'wp:term']) {
	for (const data of xml.rss.channel['0'][section]) {
		const a = {};
		for (const key of Object.keys(data)) {
			if (data[key].length > 1) {
				console.log(section, key, 'has more than 1 result', data[key])
			}
			a[key.replace(`${section}_`, '')] = data[key][0];
		}
		config[section.replace('wp:', '')].push(a)
	}
	delete xml.rss.channel['0'][section];
}

for (const section of ['item']) {
	for (const data of xml.rss.channel['0'][section]) {
		const a = {};
		delete data.guid;
		delete data.link;
		for (const key of Object.keys(data)) {
			if (data[key].length > 1) {continue;}
			a[key.replace('wp:', '').replace(`${section}_`, '')] = data[key][0];
			delete data[key];
		}
		if (data['wp:postmeta']) {
			a.frontmatter = {};
			for (const metadata of data['wp:postmeta']) {
				const key = metadata['wp:meta_key'][0];
				const value = metadata['wp:meta_value'][0]
				a.frontmatter[key] = value;
				if (value[1] === ":") {
					try {
						a.frontmatter[key] = unserialize(value);
					} catch (e) {
						console.log(a.post_id, e);
					}
				}
			}
			delete data['wp:postmeta'];
		}
		if (a['content:encoded']) {
			try {
				a.adoc = await convertBody(a['content:encoded']).then(({stdout}) => stdout);
			} catch (e) {
				console.log(`error processing [#${a.post_id} - ${a.post_name}]`, e)
			}
		}
		delete a["content:encoded"];
		delete a["excerpt:encoded"];

		config[section.replace('wp:', '')].push(a)
	}
}

console.log("Starting writing");
await fs.writeFile('./jenkinsistheway.json', JSON.stringify(config, null, 4));
console.log("End writing");

// <wp:base_site_url>https://jenkinsistheway.io</wp:base_site_url>
// <wp:base_blog_url>https://jenkinsistheway.io</wp:base_blog_url>
// <wp:tag><wp:term_id>165</wp:term_id><wp:tag_slug><![CDATA[and-custom-tools]]></wp:tag_slug><wp:tag_name><![CDATA[and Custom Tools]]></wp:tag_name></wp:tag>
// <wp:term> <wp:term_id>45</wp:term_id> <wp:term_taxonomy><![CDATA[elementor_library_type]]></wp:term_taxonomy> <wp:term_slug><![CDATA[single]]></wp:term_slug> <wp:term_parent><![CDATA[]]></wp:term_parent> <wp:term_name><![CDATA[single]]></wp:term_name> </wp:term>
