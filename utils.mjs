import {spawn} from 'child_process';
import Asciidoctor from 'asciidoctor';

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
