import assert from 'assert';
import {rehype} from 'rehype'
import {rehypeFixBoldSpaces, rehypeStripImage, rehypeFixHeaders, rehypeRemoveEmpty, rehypeStripNBSP} from './utils.mjs';

const tests = [
	{
		str: '<p><b>Progamming Language:&nbsp;&nbsp;</b>Java, PHP&nbsp;</p>',
		expected: '<p><b>Progamming Language:</b> Java, PHP </p>',

	},
	{
		str: '<p><b>Programming Language: </b>Java, Node.js, Python</p>',
		expected: '<p><b>Programming Language:</b> Java, Node.js, Python</p>',
	},
	{
		str: '<h2><b><i> </i> </b><i>not empty</i></b></h2>',
		expected: '<h2><i>not empty</i></h2>'
	},
	{str: '<h1><strong>Strongs shouldnt exist</strong></h1>', expected: '<h1>Strongs shouldnt exist</h1>'},
	{str: '<h1><emphasis>Em shouldnt exist</emphasis></h1>', expected: '<h1>Em shouldnt exist</h1>'},
	{str: '<img src="something" srcset="ahh" />', expected: '<img src="something">'},
	{str: '<p><b> Solution &amp; Results: </b>&nbsp;To achieve our goals, we introduced a Jenkins Declarative Pipeline using EC2 Dynamic Instances combined with Blue Ocean. We were able to spin up agents just when needed, which was vital for this endeavor.</p>', expected: '<p> <b>Solution &amp; Results:</b> To achieve our goals, we introduced a Jenkins Declarative Pipeline using EC2 Dynamic Instances combined with Blue Ocean. We were able to spin up agents just when needed, which was vital for this endeavor.</p>'},
	{str: '<h2><i>Submitted By Jenkins User</i><i> Antoine Pritzy</i></h2><h3><strong>Administrator turns to Jenkins to create a completely open source CI platform.</strong></h3>', expected: '<h2><i>Submitted By Jenkins User</i> <i>Antoine Pritzy</i></h2><h3>Administrator turns to Jenkins to create a completely open source CI platform.</h3>'},
	{str: '<p><b>Space after</b>nextword</p>', expected: '<p><b>Space after</b> nextword</p>'},
	{
		str: '<div> <p><b>Solution &amp; Results: </b></p><p>Due to the issues highlighted above</p></div>',
		expected: '<div> <p><b>Solution &amp; Results:</b> </p><p>Due to the issues highlighted above</p></div>'
	},
];

for (const test of tests) {
	const newContent = await rehype()
		.data('settings', {fragment: true, entities: {useNamedReferences: true}})
		.use(rehypeRemoveEmpty)
		.use(rehypeFixBoldSpaces)
		.use(rehypeStripImage)
		.use(rehypeFixHeaders)
		.use(rehypeStripNBSP)
		.process(test.str)

	assert.equal(
		String(newContent),
		test.expected
	);
}

console.log('success')
