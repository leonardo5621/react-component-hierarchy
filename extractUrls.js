const fs = require('fs');
const _ = require('lodash');
const parser = require('@babel/parser');
const traverse = require("@babel/traverse").default;


let file = fs.readFileSync('../hopia/src/App.js', 'utf8');
let ast = parser.parse(file,{sourceType: 'module', plugins: ['jsx']});
let urlNodes = {};

function cleanUrls(urlObject){
  const falsyKeys = ["", null, 0, undefined, "Route", "Router"]
  let cleanedUrls = _.omit(urlObject, falsyKeys);

  for(const k in urlObject){
    if(k !== "Base"){
      cleanedUrls[k] = _.uniq(cleanedUrls[k]);
    }
  }
  return cleanedUrls;
}

const RouteVisitor = {
    JSXElement: {
      enter(path) {
        if(path.node.children.length === 0){
          if(this.urlNodes[path.node.openingElement.name.name]){
            this.urlNodes[path.node.openingElement.name.name].push(this.identifiedUrl.url);
          } else{
            this.urlNodes[path.node.openingElement.name.name] = [this.identifiedUrl.url];
          }
        }     
      }
    }
};

traverse(ast, {
    JSXOpeningElement(path){
      if (path.node.name.name === "Router") {
        let filteredAttr = path.node.attributes.filter((attr) => attr.name.name === "basename");
        urlNodes.Base = filteredAttr[0]["value"]["expression"]["value"];
      }
    },
    JSXElement(path) {    
       if(path.node["openingElement"]["name"]["name"] === "Route"){ 
          let identifiedUrl = {component: "", url: ""};
          path.node.openingElement.attributes.forEach((attr) => {
          if(attr.name.name === "path"){
            identifiedUrl.url = attr.value.value;
          } else if(attr.name.name === "component"){
            identifiedUrl.component = attr.value.expression.name;
          }

          if(identifiedUrl.component === "" && (identifiedUrl.url)){
            path.traverse(RouteVisitor, { identifiedUrl, urlNodes});
            return false;
          }
          });
      }
    }
  });

console.log(cleanUrls(urlNodes));