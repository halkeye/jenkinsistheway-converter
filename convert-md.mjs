import {Parser} from 'xml2js';
import {unserialize} from 'php-serialize'
import fs from 'fs/promises';
import {rehype} from 'rehype'
import rehypeFormat from 'rehype-format'
import {visitParents} from 'unist-util-visit-parents';
import {toHtml} from 'hast-util-to-html'

import {convertHtmlToMarkdown} from './utils.mjs';

const parser = new Parser();
const xml = await parser.parseStringPromise(
	await fs.readFile("./jenkins.WordPress.2022-01-22.xml")
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
		//if (a.post_name !== 'a-stable-projects-life') {
		//  continue
		//}
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
				const newContent = await rehype()
					.use(function () {
						return (tree, _file) => {
							return visitParents(tree, function (node, _ancestors) {
								if (node.tagName === 'h1' || node.tagName === 'h2' || node.tagName === 'h3' || node.tagName === 'h4' || node.tagName === 'h5' || node.tagName === 'h6') {
									// fix <h1><strong>foo</strong></h1> to just be <h1>foo</h1>
									if (node.children?.[0]?.tagName == 'strong' || node.children?.[0]?.tagName == 'emphasis') {
										node.children = node.children[0].children;
									}
								}
								//const parent = ancestors[ancestors.length - 1];

								//const isB = (node.tagName === 'b' || node.tagName === 'strong');
								//const hasChildren = !!node.children;
								//if (isB && hasChildren) {
								//  const sibling = parent.children[parent.children.indexOf(node) + 1];

								//  // if we have the : in the text, move it to the bold
								//  if (sibling?.value?.trim()?.startsWith(':')) {
								//    sibling.value = ' ' + sibling.value.trim().replace(/^:/, '').trim();
								//    node.children[0].value = node.children[0].value.trim() + ':';
								//  }

								//  const textBody = node.children.filter(child => child.value).find(child => child.value.trim().endsWith(':'));
								//  console.log('parent.before', toHtml(parent));
								//  if (textBody) {
								//    textBody.value = textBody.value.trim();
								//    visitParents([{tagName: 'something', children: [sibling]}], 'text', function (child) {
								//      console.log(child)
								//      [> Remove double spaces <]
								//      child.value = ' ' + child.value.trim();
								//    });
								//  }
								//}
								if (node.tagName === 'img') {
									if (node.properties) {
										node.properties = {
											alt: node.properties.alt,
											src: node.properties.src,
										}
									} else {
										console.log('no properties', node);
									}
								}
								return node;
							})
						}
					})
					.use(rehypeFormat)
					.process(a['content:encoded'])

				let html = String(newContent)
					.replace(/:\s+<\/b>\s*\b/g, ':</b> ')
					.replace(/<\/b>\s\s+/g, '</b> ')
					.replace(/:\s+<\/strong>\s*\b/g, ':</strong> ')
					.replace(/<\/strong>\s\s+/g, '</strong> ')
				//console.log(html);
				a.md = await convertHtmlToMarkdown(html)
					.then(md => md.toString('utf8').trim())
					.then(md => md.replace(/^\*\*([^\*]+)\*\*: \b/gm, '**$1:** '))
				//console.log(String(newContent), a.md)
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
await fs.writeFile('./jenkinsistheway-md.json', JSON.stringify(config.item, null, 4));
console.log("End writing");

// <wp:base_site_url>https://jenkinsistheway.io</wp:base_site_url>
// <wp:base_blog_url>https://jenkinsistheway.io</wp:base_blog_url>
// <wp:tag><wp:term_id>165</wp:term_id><wp:tag_slug><![CDATA[and-custom-tools]]></wp:tag_slug><wp:tag_name><![CDATA[and Custom Tools]]></wp:tag_name></wp:tag>
// <wp:term> <wp:term_id>45</wp:term_id> <wp:term_taxonomy><![CDATA[elementor_library_type]]></wp:term_taxonomy> <wp:term_slug><![CDATA[single]]></wp:term_slug> <wp:term_parent><![CDATA[]]></wp:term_parent> <wp:term_name><![CDATA[single]]></wp:term_name> </wp:term>
