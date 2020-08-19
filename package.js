import xpath from 'xpath'

const namespaceMap = {
  xml: 'http://www.w3.org/XML/1998/namespace',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
}

const selectAll = xpath.useNamespaces(namespaceMap)
const select = function (expression, node) {
  return selectAll(expression, node, true)
}

/**
 * inverse of `namespaceMap`
 * ```
 *  {
 *    'http://www.idpf.org/2007/opf': 'opf',
 *    ...
 *  }
 * ```
 */
const prefixMap = Object.assign(
  {},
  ...Object.entries(namespaceMap).map(([prefix, namespace]) => ({
    [namespace]: prefix,
  }))
)

const nodeTypeMap = () => ({
  'opf:package': Package,
  'opf:metadata': Metadata,
  'opf:manifest': Manifest,
  'opf:spine': Spine,
  'opf:meta': Meta,
  'opf:item': ManifestItem,
  'opf:itemref': SpineItem,
  'opf:link': Link,
  // 'opf:collection': Collection,
  'dc:identifier': Identifier,
  'dc:title': Title,
  'dc:language': Language,
  'dc:contributor': Contributor,
  'dc:coverage': Coverage,
  'dc:creator': Creator,
  'dc:date': Date,
  'dc:description': Description,
  'dc:format': Format,
  'dc:publisher': Publisher,
  'dc:relation': Relation,
  'dc:rights': Rights,
  'dc:source': Source,
  'dc:subject': Subject,
  'dc:type': Type,
})

class Node {
  constructor(node, context) {
    this.node = node
    this.context = context
  }

  select(expression) {
    return select(expression, this.node)
  }

  selectAll(expression) {
    return selectAll(expression, this.node)
  }

  resolve(expression, constructor = null) {
    const node = this.select(expression)
    if (!node) {
      return null
    }
    if (constructor) {
      return new constructor(node, this.context)
    }
    return node.value
  }

  resolveAll(expression, constructor = null) {
    const nodes = this.selectAll(expression)
    if (!nodes) {
      return null
    }
    if (constructor) {
      return nodes.map((node) => new constructor(node, this.context))
    }
    return nodes.map((node) => node.value)
  }

  id() {
    return this.resolve('./@id')
  }
}

let mix = (superclass) => new MixinBuilder(superclass)

class MixinBuilder {
  constructor(superclass) {
    this.superclass = superclass
  }

  with(...mixins) {
    return mixins.reduce((c, mixin) => mixin(c), this.superclass)
  }
}

// Node mixins

const Value = (superclass) =>
  class extends superclass {
    value() {
      const textNode = this.select('./text()')
      if (textNode) {
        return textNode.data
      }
    }
  }

const I18n = (superclass) =>
  class extends superclass {
    dir() {
      return (
        this.resolve('./@dir') ||
        this.resolve('../@dir') ||
        this.context.resolve('./@dir')
      )
    }

    lang() {
      return (
        this.resolve('./@xml:lang') ||
        this.resolve('../@xml:lang') ||
        this.context.resolve('./@xml:lang')
      )
    }
  }

const Resource = (superclass) =>
  class extends superclass {
    href() {
      return this.resolve('./@href')
    }

    mediaType() {
      return this.resolve('./@media-type')
    }
  }

const Refines = (superclass) =>
  class extends superclass {
    refines() {
      const refines = this.resolve('./@refines')
      if (!refines) {
        return null
      }

      // drop the # prefix
      const idRefined = refines[0] === '#' ? refines.substr(1) : refines
      const node = this.context.select(`//*[@id='${idRefined}']`)
      if (!node) {
        return null
      }

      const name = node.localName
      const namespace = node.namespaceURI
      const prefix = prefixMap[namespace]
      const typeConstructor = nodeTypeMap()[`${prefix}:${name}`]
      if (!typeConstructor) {
        return null
      }

      return new typeConstructor(node, this.context)
    }
  }

const PropertiesList = (superclass) =>
  class extends superclass {
    properties() {
      const properties = this.resolve('./@properties')
      if (properties) {
        // normalize spaces and split space separated words
        return properties.replace(/\s+/g, ' ').split(' ')
      }
    }
  }

const MetaAttributes = (superclass) =>
  class extends superclass {
    property() {
      return this.resolve('./@property')
    }

    scheme() {
      return this.resolve('./@scheme')
    }
  }

const MetaProperties = (superclass) =>
  class extends superclass {
    alternateScript() {
      return this.context
        .metadata()
        .resolveMetaPropertyAll(this.id(), 'alternate-script')
    }

    displaySeq() {
      return this.context
        .metadata()
        .resolveMetaProperty(this.id(), 'display-seq')
    }

    fileAs() {
      return this.context.metadata().resolveMetaProperty(this.id(), 'file-as')
    }

    groupPosition() {
      return this.context
        .metadata()
        .resolveMetaProperty(this.id(), 'group-position')
    }

    metaAuth() {
      return this.context.metadata().resolveMetaProperty(this.id(), 'meta-auth')
    }
  }

class Meta extends mix(Node).with(
  Value,
  I18n,
  Refines,
  MetaAttributes,
  MetaProperties
) {
  get __typename() {
    return 'Meta'
  }
}

const toArray = (valueOrArray) => {
  if (!valueOrArray) {
    return []
  }
  if (Array.isArray(valueOrArray)) {
    return valueOrArray
  }
  return [valueOrArray]
}

const attributeFilter = (attribute, values, operator = 'or') =>
  values && values.length
    ? `[${toArray(values)
        .map((value) => `${attribute}='${value}'`)
        .join(` ${operator} `)}]`
    : ''

const attributeContainsWordFilter = (attribute, words, operator) =>
  words && words.length
    ? `[${toArray(words)
        .map(
          (value) =>
            `contains(concat(' ', normalize-space(${attribute}), ' '), ' ${value} ')`
        )
        .join(` ${operator} `)}]`
    : ''

const idFilter = (id) => attributeFilter('@id', id)

const anyPropertiesFilter = (anyProperties) =>
  attributeContainsWordFilter('@properties', anyProperties, 'or')
const allPropertiesFilter = (allProperties) =>
  attributeContainsWordFilter('@properties', allProperties, 'and')

const anyRelFilter = (anyProperties) =>
  attributeContainsWordFilter('@rel', anyProperties, 'or')
const allRelFilter = (allProperties) =>
  attributeContainsWordFilter('@rel', allProperties, 'and')

class Spine extends Node {
  get __typename() {
    return 'Spine'
  }

  pageProgressionDirection() {
    return this.resolve('./@page-progression-direction')
  }

  toc() {
    const idref = this.resolve('./@toc')
    if (idref) {
      return toArray(this.context.manifest().item({ id: idref }))[0]
    }
  }

  itemref({ id, anyProperties, allProperties, onlyProperties, linear }) {
    if (linear !== undefined) {
      return this.itemref({
        id,
        anyProperties,
        allProperties,
        onlyProperties,
      }).filter((item) => item.linear() === linear)
    }

    if (onlyProperties) {
      return this.itemref({
        id,
        anyProperties,
        allProperties: onlyProperties,
      }).filter(
        (item) => toArray(item.properties()).length === onlyProperties.length
      )
    }

    const expression = `./opf:itemref${idFilter(id)}${anyPropertiesFilter(
      anyProperties
    )}${allPropertiesFilter(allProperties)}`

    return this.resolveAll(expression, SpineItem)
  }
}

class SpineItem extends mix(Node).with(PropertiesList) {
  get __typename() {
    return 'SpineItem'
  }

  idref() {
    const idref = this.resolve('./@idref')
    if (idref) {
      return toArray(this.context.manifest().item({ id: idref }))[0]
    }
  }

  linear() {
    const linear = this.resolve('./@linear')
    if (linear === 'no') {
      return false
    }
    return true
  }
}

class ManifestItem extends mix(Node).with(Resource, PropertiesList) {
  get __typename() {
    return 'ManifestItem'
  }

  mediaOverlay() {
    const idref = this.resolve('./@media-overlay')
    if (idref) {
      return toArray(this.context.manifest().item({ id: idref }))[0]
    }
  }

  fallback() {
    const idref = this.resolve('./@fallback')
    if (idref) {
      return toArray(this.context.manifest().item({ id: idref }))[0]
    }
  }
}

class Manifest extends Node {
  get __typename() {
    return 'Manifest'
  }

  item({ id, href, anyProperties, allProperties, onlyProperties }) {
    if (onlyProperties) {
      return this.item({
        id,
        anyProperties,
        allProperties: onlyProperties,
      }).filter(
        (item) => toArray(item.properties()).length === onlyProperties.length
      )
    }

    const expression = `./opf:item${idFilter(id)}${attributeFilter(
      '@href',
      href
    )}${anyPropertiesFilter(anyProperties)}${allPropertiesFilter(
      allProperties
    )}`

    return this.resolveAll(expression, ManifestItem)
  }
}

class Identifier extends mix(Node).with(Value, MetaProperties) {
  get __typename() {
    return 'Identifier'
  }

  identifierType() {
    return this.resolveMetaProperty('identifier-type')
  }
}

class Title extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Title'
  }

  titleType() {
    return this.resolveMetaProperty('title-type')
  }
}

class Language extends mix(Node).with(Value, MetaProperties) {
  get __typename() {
    return 'Language'
  }
}

class Contributor extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Contributor'
  }

  role() {
    return this.resolveMetaProperty('role')
  }
}

class Coverage extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Coverage'
  }
}

class Creator extends Contributor {
  get __typename() {
    return 'Creator'
  }
}

class Date extends mix(Node).with(Value, MetaProperties) {
  get __typename() {
    return 'Date'
  }
}

class Description extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Description'
  }
}

class Format extends mix(Node).with(Value, MetaProperties) {
  get __typename() {
    return 'Format'
  }
}

class Publisher extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Publisher'
  }
}

class Relation extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Relation'
  }
}

class Rights extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Rights'
  }
}

class Source extends Identifier {
  get __typename() {
    return 'Source'
  }

  sourceOf() {
    return this.resolveMetaProperty('source-of')
  }
}

class Subject extends mix(Node).with(Value, I18n, MetaProperties) {
  get __typename() {
    return 'Subject'
  }

  authority() {
    return this.resolveMetaProperty('authority')
  }

  term() {
    return this.resolveMetaProperty('term')
  }
}

class Type extends mix(Node).with(Value, MetaProperties) {
  get __typename() {
    return 'Type'
  }
}

class BelongsToCollection extends mix(Node).with(
  Value,
  I18n,
  Refines,
  MetaAttributes,
  MetaProperties
) {
  get __typename() {
    return 'BelongsToCollection'
  }

  identifier() {
    return this.context.resolveMetaProperty(this.id(), 'dcterms:identifier')
  }

  collectionType() {
    return this.context.resolveMetaProperty(this.id(), 'collection-type')
  }

  belongsToCollection() {
    return this.context.resolveMetaPropertyAll(
      this.id(),
      'belongs-to-collection',
      BelongsToCollection
    )
  }
}

class Link extends mix(Node).with(Resource, PropertiesList, Refines) {
  get __typename() {
    return 'Link'
  }

  rel() {
    const rel = this.resolve('./@rel')
    if (rel) {
      // normalize spaces and split space separated words
      return rel.replace(/\s+/g, ' ').split(' ')
    }
  }
}

class Metadata extends Node {
  get __typename() {
    return 'Metadata'
  }

  constructor(node, context) {
    super(node, context)

    this.metaPropertyMap = {}

    const metaRefiningNodes = toArray(
      this.selectAll('./opf:meta[@refines and @property]')
    )

    metaRefiningNodes.forEach((meta) => {
      const refinesAttr = select('./@refines', meta)
      if (!refinesAttr) {
        return
      }
      const refinesValue = refinesAttr.value

      // drop the # prefix
      const idRefined =
        refinesValue[0] === '#' ? refinesValue.substr(1) : refinesValue

      const propertyAttr = select('./@property', meta)
      if (!propertyAttr) {
        return
      }
      const property = propertyAttr.value

      if (!this.metaPropertyMap[idRefined]) {
        this.metaPropertyMap[idRefined] = {}
      }

      if (!this.metaPropertyMap[idRefined][property]) {
        this.metaPropertyMap[idRefined][property] = []
      }

      this.metaPropertyMap[idRefined][property].push(meta)
    })
  }

  resolveMetaProperty(id, property, constructor = Meta) {
    return toArray(this.resolveMetaPropertyAll(id, property, constructor))[0]
  }

  resolveMetaPropertyAll(id, property, constructor = Meta) {
    const propertyMap = this.metaPropertyMap[id]
    if (!propertyMap) {
      return null
    }

    const metaNodes = propertyMap[property]
    if (!metaNodes) {
      return null
    }

    return metaNodes.map((node) => new constructor(node, this.context))
  }

  identifier({ id }) {
    return this.resolve(`./dc:identifier${idFilter(id)}`, Identifier)
  }

  modified() {
    const node = this.select(
      "./opf:meta[@property='dcterms:modified' and not(@refines)]"
    )
    if (node) {
      return new Meta(node, this.context)
    }
  }

  title({ id }) {
    return this.resolveAll(`./dc:title${idFilter(id)}`, Title)
  }

  language({ id }) {
    return this.resolveAll(`./dc:language${idFilter(id)}`, Language)
  }

  contributor({ id }) {
    return this.resolveAll(`./dc:contributor${idFilter(id)}`, Contributor)
  }

  coverage({ id }) {
    return this.resolveAll(`./dc:coverage${idFilter(id)}`, Coverage)
  }

  creator({ id }) {
    return this.resolveAll(`./dc:creator${idFilter(id)}`, Creator)
  }

  date({ id }) {
    return this.resolveAll(`./dc:date${idFilter(id)}`, Date)
  }

  description({ id }) {
    return this.resolveAll(`./dc:description${idFilter(id)}`, Description)
  }

  format({ id }) {
    return this.resolveAll(`./dc:format${idFilter(id)}`, Format)
  }

  publisher({ id }) {
    return this.resolveAll(`./dc:publisher${idFilter(id)}`, Publisher)
  }

  relation({ id }) {
    return this.resolveAll(`./dc:relation${idFilter(id)}`, Relation)
  }

  rights({ id }) {
    return this.resolveAll(`./dc:rights${idFilter(id)}`, Rights)
  }

  source({ id }) {
    return this.resolveAll(`./dc:source${idFilter(id)}`, Source)
  }

  subject({ id }) {
    return this.resolveAll(`./dc:subject${idFilter(id)}`, Subject)
  }

  type({ id }) {
    return this.resolveAll(`./dc:type${idFilter(id)}`, Type)
  }

  belongsToCollection({ id }) {
    return this.resolveAll(
      `./opf:meta${idFilter(
        id
      )}[@property='belongs-to-collection' and not(@refines)]`,
      BelongsToCollection
    )
  }

  meta({ id, property, refines }) {
    return this.resolveAll(
      `./opf:meta${idFilter(id)}${attributeFilter(
        '@property',
        property,
        'and'
      )}${attributeFilter('@refines', refines ? `#${refines}` : null, 'or')}`,
      Meta
    )
  }

  link(args) {
    const {
      id,
      href,
      anyProperties,
      allProperties,
      onlyProperties,
      anyRel,
      allRel,
      onlyRel,
    } = args

    if (onlyProperties) {
      return this.link({
        ...args,
        allProperties: onlyProperties,
        onlyProperties: undefined,
      }).filter(
        (item) => toArray(item.properties()).length === onlyProperties.length
      )
    }

    if (onlyRel) {
      return this.link({ ...args, allRel: onlyRel, onlyRel: undefined }).filter(
        (item) => toArray(item.rel()).length === onlyRel.length
      )
    }

    const expression = `./opf:link${idFilter(id)}${attributeFilter(
      '@href',
      href
    )}${anyPropertiesFilter(anyProperties)}${allPropertiesFilter(
      allProperties
    )}${anyRelFilter(anyRel)}${allRelFilter(allRel)}`

    return this.resolveAll(expression, Link)
  }
}

export class Package extends mix(Node).with(I18n) {
  get __typename() {
    return 'Package'
  }

  constructor(doc) {
    super(select('/opf:package', doc))
    this.context = this
  }

  version() {
    return this.resolve('./@version')
  }

  uniqueIdentifier() {
    const uniqueIdentifierIDRef = this.resolve('./@unique-identifier')
    if (uniqueIdentifierIDRef) {
      return this.metadata().identifier({ id: uniqueIdentifierIDRef })
    }
  }

  releaseIdentifier() {
    const uniqueIdentifier = this.uniqueIdentifier()
    const modified = this.metadata().modified()
    if (uniqueIdentifier && modified) {
      return `${uniqueIdentifier.value()}@${modified.value()}`
    }
  }

  metadata() {
    return (this._metadata =
      this._metadata || this.resolve('./opf:metadata', Metadata))
  }

  spine() {
    return (this._spine = this._spine || this.resolve('./opf:spine', Spine))
  }

  manifest() {
    return (this._manifest =
      this._manifest || this.resolve('./opf:manifest', Manifest))
  }
}
