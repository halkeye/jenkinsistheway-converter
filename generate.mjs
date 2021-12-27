import {readFile} from 'fs/promises'

const data = await readFile('./jenkinsistheway.json', 'utf8').then(str => JSON.parse(str));
console.log(data);
