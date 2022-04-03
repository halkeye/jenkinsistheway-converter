import {spawn} from 'child_process';
import Asciidoctor from 'asciidoctor';
import {visitParents} from 'unist-util-visit-parents';
import {toHtml} from 'hast-util-to-html';

import util from 'util';
util.inspect.defaultOptions.depth = 10;

// from https://stackoverflow.com/a/2970667
export function keyize(str) {
	return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
		if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
		return index === 0 ? match.toLowerCase() : '_' + match.toLowerCase();
	});
}

export function dontIndent(str) {
	return ('' + str).replace(/^[ \t]+/mg, '');
}

export function escapeRegExp(string) {
	return string
		.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
		.replace(/\s+/g, '\\s+');
}

export function findNested(data, fn) {
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

export async function convertHtmlToAdoc(body) {
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
	return spawnPromise(command, args, body);
}

export async function convertAdocToMarkdown(body) {
	const asciidoctor = new Asciidoctor()
	const html = asciidoctor.convert(body)

	const command = 'pandoc';
	const args = [
		'--wrap=none',
		'-f',
		'html',
		'-t',
		'markdown_strict',
		'--atx-headers',
		'-o',
		'-',
		'-',
	];
	return spawnPromise(command, args, html);
}

export async function convertHtmlToMarkdown(body) {
	const command = 'pandoc';
	const args = [
		'--wrap=none',
		'-f',
		'html',
		'-t',
		'markdown_strict',
		'--atx-headers',
		'-o',
		'-',
		'-',
	];
	return spawnPromise(command, args, body);
}

// borrowed from https://www.npmjs.com/package/spawn-promise but cleaned up
async function spawnPromise(command, args, input) {
	const exitCodes = {
		1: 'Uncaught Fatal Exception',
		3: 'Internal JavaScript Parse Error',
		4: 'Internal JavaScript Evaluation Failure',
		5: 'Fatal Error',
		6: 'Non-function Internal Exception Handler',
		7: 'Internal Exception Handler Run-Time Failure',
		9: 'Invalid Argument',
		10: 'Internal JavaScript Run-Time Failure',
		12: 'Invalid Debug Argument'
	};
	const isEmpty = object => Object.keys(object).length === 0;

	const child = spawn(command, args, {
		encoding: 'utf8',
		env: {...process.env, LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8'},
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	// Capture errors
	const errors = {};
	const stderrOutput = {}
	child.on('error', error => errors.spawn = error);
	child.stdin.on('error', error => errors.stdin = error);
	child.stdout.on('error', error => errors.stdout = error);
	child.stderr.setEncoding('utf8');
	child.stderr.on('error', error => errors.stderr = error);
	child.stderr.on('data', data => {
		if (!stderrOutput.process) stderrOutput.process = '';
		stderrOutput.process += data;
	});

	// Capture output
	const buffers = [];
	child.stdout.on('data', data => buffers.push(data));

	// Run
	const exitCode = await new Promise(resolve => {
		child.on('close', (code, _signal) => resolve(code));
		child.stdin.end(input);
	});

	if (exitCode !== 0) {
		errors.exit = `Command failed: ${exitCode}: ${exitCodes[exitCode]}`;
		errors.process = stderrOutput.process;
	}

	// Return
	if (!isEmpty(errors)) throw new Error(JSON.stringify(errors));
	return Buffer.concat(buffers);
}


export function cleanString(str) {
	return str
		.replace(/[\u2014]/g, "--")        // emdash
		.replace(/[\u2022]/g, "*")         // bullet
		.replace(/[\u2018\u2019]/g, "'")   // smart single quotes
		.replace(/[\u201C\u201D]/g, '"')   // smart double quotes
		.replace(/[“|”]/g, '"');           // smart double quotes
}

export function rehypeStripNBSP() {
	return (tree, _file) => {
		visitParents(tree, 'text', function (node, ancestors) {
			node.value = node.value.replaceAll('\u00A0', ' ');
		})
	}
}

export function rehypeRemoveEmpty() {
	return (tree, _file) => {
		for (; ;) {
			let madeChanges = 0;
			visitParents(tree, (node => ['i', 'strong', 'emphasis', 'b'].includes(node.tagName)), function (node, ancestors) {
				const parent = ancestors[ancestors.length - 1];
				let oldLength = node.children.length;

				node.children = node.children.filter(child => {
					if (child.type !== 'text') {
						return true; // keep
					}
					if (child.value?.trim()) {
						return true; // keep
					}
					return false
				})
				if (!node.children.length) {
					parent.children = parent.children.filter(i => i !== node);
				}

				if (oldLength !== node.children.length) {
					madeChanges = 1;
				}
			})

			if (!madeChanges) {
				break;
			}
		}
	}
}

export function rehypeFixBoldSpaces() {
	const STARTS_WITH_REGEX = /^(&nbsp;|\s)+(.*?)$/
	const ENDS_WITH_REGEX = /^(.*?)(&nbsp;|\s)+$/;

	return (tree, _file) => {
		return visitParents(tree, (node => ['i', 'strong', 'emphasis', 'b'].includes(node.tagName)), function (node, ancestors) {
			const parent = ancestors[ancestors.length - 1];

			if (node?.children?.[0]?.type == 'text') {
				const child = node.children[0];

				if (!child.value.trim()) {
					return;
				}

				if (child.value.match(STARTS_WITH_REGEX)) {
					const newNode = {
						type: 'text',
						value: ' ',
					}
					const parentIndex = parent.children.indexOf(node);
					child.value = child.value.match(STARTS_WITH_REGEX)[2]
					parent.children = [
						...parent.children.slice(0, parentIndex),
						newNode,
						...parent.children.slice(parentIndex, parent.children.length)
					]
				}

				if (child.value.match(ENDS_WITH_REGEX)) {
					const newNode = {
						type: 'text',
						value: ' ',
					}
					const parentIndex = parent.children.indexOf(node);
					child.value = child.value.match(ENDS_WITH_REGEX)[1]
					if (parentIndex !== parent.children.length - 1) {
						if (parent.children[parentIndex + 1].value) {
							parent.children[parentIndex + 1].value = parent.children[parentIndex + 1].value.trimLeft();
						}

						parent.children = [
							...parent.children.slice(0, parentIndex + 1),
							newNode,
							...parent.children.slice(parentIndex + 1, parent.children.length)
						];
					} else {
						parent.children.push({type: 'text', value: ' '});
					}
				}

				const parentIndex = parent.children.indexOf(node);
				if (parent.children[parentIndex + 1]) {
					if (parent.children[parentIndex + 1].type == 'text') {
						parent.children[parentIndex + 1].value = ' ' + parent.children[parentIndex + 1].value.trim();
					}
				}
			}
		})
	}
}

export function rehypeFixHeaders() {
	return (tree, _file) => {
		return visitParents(tree, node => ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName), function (node, _ancestors) {
			// fix <h1><strong>foo</strong></h1> to just be <h1>foo</h1>
			if (node.children?.[0]?.tagName == 'strong' || node.children?.[0]?.tagName == 'emphasis') {
				node.children = node.children[0].children;
			}
		})
	}
}

export function rehypeStripImage() {
	return (tree, _file) => {
		return visitParents(tree, (node) => node.tagName === 'img', function (node, _ancestors) {
			if (node.properties) {
				node.properties = {
					alt: node.properties.alt,
					src: node.properties.src,
				}
			} else {
				console.log('no properties', node);
			}
		})
	}
}
