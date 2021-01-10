#!/usr/bin/env node

'use strict'; // eslint-disable-line
const program = require('commander');
const path = require('path');
const traverse = require('@babel/traverse').default;
const parser = require('@babel/parser');
const babylon = require('babylon');
const readFileSync = require('fs').readFileSync;
const _ = require('lodash');
const tree = require('pretty-tree');
const constants = require('./constants');

program
  .version('1.1.0')
  .usage('[opts] <path/to/rootComponent>')
  .option(
    '-m, --module-dir <dir>',
    'Path to additional modules not included in node_modules e.g. src'
  )
  .option('-c, --hide-containers', 'Hide redux container components')
  .option('-t, --hide-third-party', 'Hide third party components')
  .description('React component hierarchy viewer.')
  .parse(process.argv);

if (!program.args[0]) {
  program.help();
}

const hideContainers = program.hideContainers;
const moduleDir = program.moduleDir;
const hideThirdParty = program.hideThirdParty;

const filename = path.resolve(program.args[0]);

const rootNode = {
  name: path.basename(filename).replace(/\.jsx?/, ''),
  filename,
  depth: 0,
  children: [],
};


const ImportVisitor = {
  ImportDeclaration(path){
    this.imports.push({name: path.node.specifiers.local.name, 
                      source: path.node.source.value});
  },
};

const RenderVisitor = {
  JSXElement(innerPath){
    const tagName = innerPath.node.openingElement.name.name
    if(tagsFilter(tagName, this.imports)){
      let tag = {name: tagName, source: this.imports[tagName]};
      tag = formatChild(tag, this.node, this.depth);
      this.tag.children.push(tag);
    } else {
      innerPath.skip();
    }

  }
};

const tagsFilter = (tag, importsList) => {
  if( !(constants.routerTags.includes(tag) || constants.jsxTags.includes(tag)) ) {
    if( importsList[tag] ){
      return true;
    } else{
      return false;
    }
  } else {
    return false;
  }
}

const childrenFilter = (childrenList) => {
  return childrenList.filter((child) => child.type === "JSXElement");
}

function formatChild(child, parent, depth, children) {
  let fileName;
  let source;

  if (child.source.startsWith('.')) {
    // Relative import (./ or ../)
    fileName = path.resolve(path.dirname(parent.filename) + '/' + child.source);
    source = fileName.replace(process.cwd() + '/', '');
  } else {
    fileName = path.join(path.dirname(parent.filename), child.source);
    source = child.source;
  }
  return {
    source,
    name: child.name,
    filename: fileName,
    children: children? children : [],
    depth,
  };
}

function extractExport(body) {
  let result;
  body.some(b => {
    if (b.type === 'ExportDefaultDeclaration') {
      result = b.declaration.name;
    }
    return result;
  });
  return result;
}

function findImportInArguments(func, imports, importNames) {
  const args = _.get(func, '.arguments', []).map(a => a.name);
  const foundImports = _.intersection(args, importNames);
  return _.get(foundImports, '[0]');
}

function findImportInExportDeclaration(body, exportIdentifier, imports) {
  let result;
  const importNames = imports.map(i => i.name);
  body.some(b => {
    if (
      b.type === 'VariableDeclaration' &&
      b.declarations[0].id.name === exportIdentifier &&
      b.declarations[0].init.type === 'CallExpression'
    ) {
      // If the export is being declared with the result of a function..
      // Try to find a reference to any of the imports either in the function arguments,
      // or in the arguments of any other functions being called after this function
      let func = b.declarations[0].init;
      while (!result && func) {
        result = findImportInArguments(func, imports, importNames);
        if (!result) {
          func = _.get(func, '.callee');
        }
      }
      if (result) {
        result = _.find(imports, { name: result });
      }
    }
    return result;
  });
  return result;
}

// - Find out what is being exported
// - Look for the export variable declaration
// - Look for any imported identifiers being used as a function parameter
// - Return that as the child
function findContainerChild(node, body, imports, depth) {
  const exportIdentifier = extractExport(body);
  const usedImport = findImportInExportDeclaration(
    body,
    exportIdentifier,
    imports
  );
  return (usedImport && [formatChild(usedImport, node, depth)]) || [];
}

function processFile(node, file, depth, filename) {
  const ast = parser.parse(file, {
    sourceType: 'module',
    plugins: [
      'asyncGenerators',
      'classProperties',
      'classProperties',
      'dynamicImport',
      'exportExtensions',
      'flow',
      'functionBind',
      'functionSent',
      'jsx',
      'objectRestSpread',
    ],
  });

  if(node.children.length !== 0 ){
    node.children.forEach(c => processNode(c, depth + 1, node));
  } else {
    // Get a list of imports and try to figure out which are child components
  let imports = {};
  let foundElements = [];

  traverse(ast,{
    ImportDeclaration(path){
      //Il faut gérer les autres cas aussi...
      if(path.node.specifiers.length === 1){
        // imports.push({name: path.node.specifiers[0].local.name, 
        //   source: path.node.source.value});
          imports[path.node.specifiers[0].local.name] = path.node.source.value;
      }     
    },
    JSXElement(path){
      const tagName = path.node.openingElement.name.name;
      if(tagsFilter(tagName, imports)){
        let tag = {name: tagName, source: imports[tagName]};
        tag = formatChild(tag, node, depth);
        path.traverse(RenderVisitor, { node, tag, imports, depth: depth+1} )
        foundElements.push(tag);
        path.stop();
      }
      //foundElements.push(path.node.openingElement.name.name);
    }
  },);
  imports = _.uniq(imports);
  
  // foundElements = foundElements.filter((tag) => {
  //   if(constants.routerTags.includes(tag.name) || constants.htmlJsxTags.includes(tag.name)){
  //     return false;
  //   } else {
  //     return true;
  //   }
  // })
  //let usedImports = imports.filter((pkg) => foundElements.includes(pkg.name));
  //node.children = usedImports.map(c => formatChild(c, node, depth));
  node.children = foundElements;
  //console.log(node.children);
  }
  
}


function formatNodeToPrettyTree(node) {
  if (hideContainers && node.name.indexOf('Container') > -1) {
    node.children[0].name += ' (*)';
    return formatNodeToPrettyTree(node.children[0]);
  }
  // If we have the source, format it nicely like `module/Component`
  // But only if the name won't be repeated like `module/Component/Component`
  const source = node.name;
    // path.basename(path.dirname(node.filename)) === node.name
    //   ? node.source
    //   : node.source + '/' + node.name;
  const newNode =
    node.children.length > 0
      ? {
          label: (node.source && source) || node.name,
          nodes: node.children
            .filter(n => !n.hide)
            .sort((a, b) => {
              // Sort the list by source and name for readability
              const nameA = (a.source + a.name).toUpperCase();
              const nameB = (b.source + b.name).toUpperCase();

              if (nameA < nameB) {
                return -1;
              }
              if (nameA > nameB) {
                return 1;
              }

              return 0;
            })
            .map(formatNodeToPrettyTree),
          depth: node.depth,
        }
      : {
          label: source,
          depth: node.depth,
        };

  return newNode;
}

function done() {
  if (!rootNode.children) {
    console.error(
      'Could not find any components. Did you process the right file?'
    );
    process.exit(1);
  }

  let newNode = formatNodeToPrettyTree(rootNode);
  console.log(tree(newNode));
  process.exit();
}

// Get a list of names to try to resolve
function getPossibleNames(baseName) {
  return [
    baseName,
    baseName.replace('.js', '.jsx'),
    baseName.replace('.js', '/index.js'),
    baseName.replace('.js', '/index.jsx'),
  ];
}

function processNode(node, depth, parent) {
  const fileExt = path.extname(node.filename);
  if (fileExt === '') {
    // It's likely users will reference files that do not have an extension, try .js and then .jsx
    node.filename = `${node.filename}.js`;
  }

  let possibleFiles = getPossibleNames(node.filename);

  if (parent && moduleDir) {
    const baseName = node.filename.replace(
      path.dirname(parent.filename),
      moduleDir
    );
    possibleFiles = possibleFiles.concat(getPossibleNames(baseName));
  }

  for (const name of possibleFiles) {
    node.filename = name;
    try {
      const file = readFileSync(node.filename, 'utf8');
      processFile(node, file, depth, node.filename);
      node.children.forEach(c => processNode(c, depth + 1, node));
      return;
    } catch (e) {
      if( !(e.code === 'ENOENT') ){
        console.log(e);
      }
    }
  }

  if (hideThirdParty) {
    node.hide = true;
  }
}

processNode(rootNode, 1);
done();
