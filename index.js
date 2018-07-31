const Misty = require('@supersoccer/misty')
const $ = Misty.Config
const mystique = Misty.Mystique
const t = Misty.Tools
const db = Misty.Dwarfs
const Cache = Misty.Yggdrasil
const template = Misty.Template
const accounts = Misty.Heimdallr
const { basepath } = Misty.Path
const _ = require('lodash')

const tpl = {
  appNotFound: template.load('errors/appNotFound'),
  pageNotFound: template.load('errors/pageNotFound'),
  forbidden: template.load('errors/forbidden')
}

class Bifrost {
  constructor () {
    this.MENU = 1
    this.ROUTES = 2

    this.services = {}
    this.getTreeModules = this.getTreeModules.bind(this)
    this._getFlatModules = this._getFlatModules.bind(this)
    this._mapModuleNames = this._mapModuleNames.bind(this)
    this.tools = this.tools.bind(this)
    this.apps = this.apps.bind(this)
    this.moduleName = this.moduleName.bind(this)
    this.registerMenu = this.registerMenu.bind(this)
  }

  cache () {
    this.cache = new Cache($.app.name)
  }

  _getModules () {
    // TODO: make this dynamic
    return new Promise((resolve, reject) => {
      db.get({
        app: $.app.name,
        key: 'modules-raw',
        query: {
          sql: `SELECT * FROM ${$.bifrost.tables.modules} WHERE deleted_at IS NULL`
        }
      }).then(this._setDefaultModule).then((modules) => {
        resolve(modules)
      }).catch((err) => {
        resolve(err)
      })
    })
  }

  _setDefaultModule (modules) {
    for (let module of modules) {
      if (module.default) {
        let defaultModule = _.clone(module)
        defaultModule.parent_id = 0
        defaultModule.route_path = '/'
        modules.unshift(defaultModule)
        break
      }
    }

    return Promise.resolve(modules)
  }

  _setParents (obj, parents) {
    if (_.isUndefined(parents)) {
      parents = []
      for (let item of obj) {
        if (parents.indexOf(item.parent_id) < 0) {
          parents.push(item.parent_id)
        }
      }
    }

    return parents
  }

  _setChilds (obj, type, parentId, parents, route, tmp) {
    for (let item of obj) {
      if (this._getTreeCondition(type, item, parentId)) {
        this._concatInheritedRoutePath(item, route)

        if (parents.indexOf(item.id) >= 0) {
          item.childs = this.tree(obj, type, item.id, parents, item.route_path)
        }

        tmp.push(item)
      }
    }
  }

  tree (obj, type, parentId, parents, route) {
    let tmp = []
    parentId = parentId || 0
    route = route || ''
    type = type || this.MENU
    parents = this._setParents(obj, parents)
    this._setChilds(obj, type, parentId, parents, route, tmp)
    tmp = _.sortBy(tmp, ['menu_order'])
    return tmp
  }

  _concatInheritedRoutePath (item, route) {
    item.route_path = `${route}/${item.route_path.replace(/^\//, '')}`
    item.route_path = item.route_path === '/*' ? '*' : item.route_path
  }

  _getTreeCondition (type, item, parentId) {
    switch (type) {
      case this.MENU:
        return item.parent_id === parentId && item.visible !== 0
      case this.ROUTES:
        return item.parent_id === parentId
    }
  }

  getTreeModules (modules) {
    const key = 'modules-tree'
    return this.cache.get(key).then(modulesTree => {
      if (_.isNull(modulesTree)) {
        modulesTree = this.tree(modules)

        this.cache.set(key, modulesTree)
      }

      return modulesTree
    })
  }

  _getFlatModules (modules) {
    const key = 'modules-flat'
    return this.cache.get(key).then(modulesFlat => {
      if (_.isNull(modulesFlat)) {
        modulesFlat = this._flatten(this.tree(modules, this.ROUTES))
        modulesFlat = _.sortBy(modulesFlat, ['route_order'])

        this.cache.set(key, modulesFlat)
      }

      return modulesFlat
    })
  }

  _mapModuleNames (modules) {
    const key = 'modules-map'
    return this.cache.get(key).then(modulesMap => {
      if (_.isNull(modulesMap)) {
        return this._getFlatModules(modules)
      }

      return modulesMap
    }).then(flatModules => {
      if (!_.isArray(flatModules)) {
        return flatModules
      }

      const modulesMap = {}

      for (let module of flatModules) {
        modulesMap[`${module.route_method}:${module.route_path}`] = module
      }

      this.cache.set(key, modulesMap)
      return modulesMap
    })
  }

  tools (req, res, next) {
    res.locals.t = t
    res.locals.t.runtime = {
      query: req.query,
      path: req.path,
      originalUrl: req.originalUrl,
      params: req.params,
      appId: res.locals.appId
    }
    next()
  }

  _getApps () {
    return db.get({
      app: $.app.name,
      key: 'apps-raw',
      query: {
        sql: `SELECT * FROM ${$.bifrost.tables.apps} WHERE deleted_at IS NULL`
      }
    })
  }

  apps (req, res, next) {
    this._getApps().then(apps => {
      res.locals.apps = apps

      if (!_.isUndefined(req.query)) {
        if (!_.isUndefined(req.query.app_id)) {
          const appId = req.query.app_id.replace(/[^0-9a-z_-]*/i, '')
          if (!_.isUndefined(_.find(apps, { identifier: appId }))) {
            res.locals.appId = appId
          }
        }
      }
      next()
    })
  }

  moduleName (req, res, next) {
    this._getModules().then(this._mapModuleNames).then(modules => {
      const key = `${req.method.toUpperCase()}:${req.route.path}`
      res.locals.module = modules[key]
      res.locals.path = req.path
      res.locals.method = req.method
      next()
    }).catch(error => {
      res.locals.module = null
      console.error(error)
      next()
    })
  }

  _menu () {
    return this._getModules().then(this.getTreeModules)
  }

  _hasAccess (roles, module, superuser) {
    if (module.visible === -1 || superuser) {
      return true
    }

    const role = _.find(roles, { moduleId: module.id })

    if (_.isUndefined(role)) {
      return false
    }

    return role.roles.read
  }

  _pushValidItem (items, item, hasChilds, depth) {
    if ((depth === 0 && !hasChilds) || (depth === 1 && hasChilds && item.childs.length === 0)) {
      return
    }

    items.push(item)
  }

  _authorizedMenuItems (menuItems, res, depth) {
    const roles = res.locals.IAM.roles
    const superuser = res.locals.IAM.superuser
    const moduleId = res.locals.module.id
    const items = []
    depth = depth || 0

    for (let item of menuItems) {
      if (!this._hasAccess(roles, item, superuser)) {
        continue
      }

      if (item.id === moduleId) {
        item.active = true
      }

      const hasChilds = !_.isUndefined(item.childs)

      if (hasChilds) {
        item.childs = this._authorizedMenuItems(item.childs, res, depth + 1)

        if (item.childs.length > 0) {
          if (_.find(item.childs, { active: true })) {
            item.childActive = true
          }
        }
      }

      this._pushValidItem(items, item, hasChilds, depth)
    }

    return items
  }

  registerMenu (req, res, next) {
    // const roles = res.locals.IAM.roles

    this._menu().then(menuItems => {
      res.locals.menuItems = this._authorizedMenuItems(menuItems, res)
      next()
    }).catch(error => {
      res.locals.menuItems = null
      console.error(error)
      next()
    })
  }

  _flatten (obj) {
    let tmp = []

    for (let item of obj) {
      tmp.push(item)
      let idx = tmp.length - 1

      if (item.childs) {
        tmp = tmp.concat(this._flatten(item.childs))
        delete tmp[idx].childs
      }
    }

    return tmp
  }

  _registerDefaultMiddlewares (params, module) {
    params.push(this._favicon)
    params.push(this._query)
    params.push(this.apps)
    params.push(accounts.passport)
    params.push(this.moduleName)
    params.push(this.tools)

    if ($.bifrost.whitelist.indexOf(module.route_path) < 0) {
      params.push(accounts.access)
      params.push(this.registerMenu)
    }

    params.push(this.validateModule)
    params.push(this.validateAppID)
    params.push(this.validateAccess)
    params.push(mystique.render)
  }

  _registerRoutePath (params, module) {
    params.push(module.route_path)
  }

  _registerModuleMiddlewares (params, module) {
    if (module.middlewares) {
      const middlewares = module.middlewares.split(',').map((middleware) => {
        return middleware.split('.')
      })

      for (let [ module, method ] of middlewares) {
        params.push(this._service(module, method))
      }
    }
  }

  _registerModuleService (params, module) {
    params.push(this._service(module.module, module.method))
  }

  _registerNotFoundRoutes (app) {
    app.get('*', this.pageNotFound)
    app.post('*', this.pageNotFound)
  }

  routes (app) {
    this.cache()
    
    return this._getModules().then(this._getFlatModules).then(modules => {
      this._registerServices('heimdallr')
      for (let module of modules) {
        const params = []
        this._registerServices(module.module)
        this._registerRoutePath(params, module)
        this._registerDefaultMiddlewares(params, module)
        this._registerModuleMiddlewares(params, module)
        this._registerModuleService(params, module)
        this._registerRoute(app, module.route_method, params)
      }
      this._registerNotFoundRoutes(app)
      this._printRegisteredRoutes(app)
    }).catch(error => {
      console.error(error)
    })
  }

  _printRegisteredRoutes (app) {
    console.log()
    console.log('[bifrost] registering routes...')
    app._router.stack.forEach(val => {
      if (val.route) {
        console.log(`[bifrost] ${val.route.stack[0].method} ${val.route.path}`)
      }
    })
    console.log()
  }

  _registerRoute (app, method, params) {
    app[method.toLowerCase()](...params)
  }

  moduleNotFound (req, res) {
    console.log(res.locals.module)
    res.send('Module not found')
  }

  pageNotFound (req, res) {
    res.sendStatus(404)
  }

  _registerServices (module) {
    if (_.isUndefined(this.services[module])) {
      if (module === 'heimdallr') {
        this.services[module] = accounts
        return
      }
      try {
        this.services[module] = require(basepath.services(module))
      } catch (e) {
        throw new Error(`Cannot import module ${module} with ${e}`)
      }
    }
  }

  _service (module, method) {
    if (!_.isUndefined(this.services[module])) {
      if (!_.isUndefined(this.services[module][method])) {
        return this.services[module][method]
      }
    }

    return this.moduleNotFound
  }

  _favicon (req, res, next) {
    if (req.path === '/favicon.ico') {
      return res.sendStatus(200)
    }
    next()
  }

  _query (req, res, next) {
    if (req.query) {
      res.locals.query = req.query
    }
    next()
  }

  validateAppID (req, res, next) {
    const path = req.path
    if (res.locals.appId || $.bifrost.whitelist.indexOf(path) >= 0) {
      return next()
    }

    res.locals.error = 'ERR_APP_NOT_FOUND'
    res.marko(tpl.appNotFound)
  }

  validateModule (req, res, next) {
    if (res.locals.module) {
      return next()
    }

    res.locals.error = 'ERR_PAGE_NOT_FOUND'
    res.marko(tpl.pageNotFound)
  }

  validateAccess (req, res, next) {
    const path = req.path

    if ($.bifrost.whitelist.indexOf(path) >= 0) {
      return next()
    }

    if (res.locals.IAM) {
      if (res.locals.IAM.permission >= res.locals.module.permission) {
        return next()
      }
    }

    res.locals.error = 'ERR_ACCESS_FORBIDDEN'
    res.marko(tpl.forbidden)
  }
}

module.exports = new Bifrost()
