import express from 'express'
import expressGraphQL from 'express-graphql'
import graphql from 'graphql'
import { readFileSync } from 'fs'

import { Package } from './package.js'
import xmldom from 'xmldom'

// Construct a schema, using GraphQL schema language
var schema = graphql.buildSchema(readFileSync('schema.graphql', 'utf-8'))

const xmlDoc = new xmldom.DOMParser().parseFromString(readFileSync('input.opf', 'utf-8'))

// The root provides a resolver function for each API endpoint
var root = {
  package: () => {
    return new Package(xmlDoc)
  },
}

var app = express()
app.use(
  '/graphql',
  expressGraphQL.graphqlHTTP({
    schema: schema,
    rootValue: root,
    graphiql: true,
  })
)
app.listen(4000)
console.log('Running a GraphQL API server at http://localhost:4000/graphql')