const path = require('path')
const hash = require('hash-sum')
const { pick } = require('lodash')
const Config = require('webpack-chain')
const { forwardSlash } = require('../utils')
const { VueLoaderPlugin } = require('vue-loader')
const createHTMLRenderer = require('../server/createHTMLRenderer')
const CSSExtractPlugin = require('mini-css-extract-plugin')

const resolve = (p, c) => path.resolve(c || __dirname, p)

module.exports = (app, { isProd, isServer }) => {
  const { config: projectConfig } = app
  const { cacheDirectory, cacheIdentifier } = createCacheOptions()
  const assetsDir = path.relative(projectConfig.outDir, projectConfig.assetsDir)
  const pathPrefix = forwardSlash(path.join(projectConfig.pathPrefix, '/'))
  const config = new Config()

  const useHash = isProd && !process.env.GRIDSOME_TEST
  const filename = `[name]${useHash ? '.[contenthash:8]' : ''}.js`
  const assetname = `[name]${useHash ? '.[hash:8]' : ''}.[ext]`
  const inlineLimit = 10000

  config.mode(isProd ? 'production' : 'development')

  config.output
    .publicPath(pathPrefix)
    .path(projectConfig.outDir)
    .chunkFilename(`${assetsDir}/js/${filename}`)
    .filename(`${assetsDir}/js/${filename}`)

  if (process.env.NODE_ENV === 'test') {
    config.output.pathinfo(true)
  }

  config.resolve
    .set('symlinks', true)
    .alias
    .set('~', resolve('src', app.context))
    .set('@', resolve('src', app.context))
    .set('gridsome$', path.resolve(projectConfig.appPath, 'index.js'))
    .end()
    .extensions
    .merge(['.js', '.vue'])
    .end()
    .modules
    .add(resolve('../../node_modules'))
    .add(resolve('../../../packages'))
    .add('node_modules')

  config.resolveLoader
    .set('symlinks', true)
    .modules
    .add(resolve('./loaders'))
    .add(resolve('../../node_modules'))
    .add(resolve('../../../packages'))
    .add('node_modules')

  config.module.noParse(/^(vue|vue-router)$/)

  if (app.config.runtimeCompiler) {
    config.resolve.alias.set('vue$', 'vue/dist/vue.esm.js')
  }

  if (!isProd) {
    config.devtool('cheap-module-eval-source-map')
  }

  // vue

  config.module.rule('vue')
    .test(/\.vue$/)
    .use('cache-loader')
    .loader('cache-loader')
    .options({
      cacheDirectory,
      cacheIdentifier
    })
    .end()
    .use('vue-loader')
    .loader('vue-loader')
    .options({
      compilerOptions: {
        preserveWhitespace: false,
        modules: [
          require('./modules/html')(),
          require('./modules/assets')()
        ]
      },
      cacheDirectory,
      cacheIdentifier
    })

  // js

  config.module.rule('js')
    .test(/\.jsx?$/)
    .exclude
    .add(filepath => {
      if (/\.vue\.jsx?$/.test(filepath)) {
        return false
      }

      if (/gridsome\.client\.js$/.test(filepath)) {
        return false
      }

      if (app.config.transpileDependencies.some(dep => {
        return typeof dep === 'string'
          ? filepath.includes(path.normalize(dep))
          : filepath.match(dep)
      })) {
        return false
      }

      if (filepath.startsWith(projectConfig.appPath)) {
        return false
      }

      return /node_modules/.test(filepath)
    })
    .end()
    .use('cache-loader')
    .loader('cache-loader')
    .options({
      cacheDirectory,
      cacheIdentifier
    })
    .end()
    .use('babel-loader')
    .loader('babel-loader')
    .options({
      presets: [
        require.resolve('@vue/babel-preset-app')
      ]
    })

  // css

  createCSSRule(config, 'css', /\.css$/, null, projectConfig.css.loaderOptions.css)
  createCSSRule(config, 'postcss', /\.p(ost)?css$/, null, projectConfig.css.loaderOptions.postcss)
  createCSSRule(config, 'scss', /\.scss$/, 'sass-loader', projectConfig.css.loaderOptions.scss)
  createCSSRule(config, 'sass', /\.sass$/, 'sass-loader', projectConfig.css.loaderOptions.sass)
  createCSSRule(config, 'less', /\.less$/, 'less-loader', projectConfig.css.loaderOptions.less)
  createCSSRule(config, 'stylus', /\.styl(us)?$/, 'stylus-loader', projectConfig.css.loaderOptions.stylus)

  // assets

  config.module.rule('images')
    .test(/\.(png|jpe?g|gif)(\?.*)?$/)
    .use('url-loader')
    .loader('url-loader')
    .options({
      limit: inlineLimit,
      name: `${assetsDir}/img/${assetname}`
    })

  config.module.rule('svg')
    .test(/\.(svg)(\?.*)?$/)
    .use('file-loader')
    .loader('file-loader')
    .options({
      name: `${assetsDir}/img/${assetname}`
    })

  config.module.rule('media')
    .test(/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/)
    .use('url-loader')
    .loader('url-loader')
    .options({
      limit: inlineLimit,
      name: `${assetsDir}/media/${assetname}`
    })

  config.module.rule('fonts')
    .test(/\.(woff2?|eot|ttf|otf)(\?.*)?$/i)
    .use('url-loader')
    .loader('url-loader')
    .options({
      limit: inlineLimit,
      name: `${assetsDir}/fonts/${assetname}`
    })

  // data

  config.module.rule('yaml')
    .test(/\.ya?ml$/)
    .use('json-loader')
    .loader('json-loader')
    .end()
    .use('yaml-loader')
    .loader('yaml-loader')

  // graphql
  // TODO: remove graphql loader before v1.0
  createGraphQLRule('graphql', './loaders/page-query')
  createGraphQLRule('page-query', './loaders/page-query')
  createGraphQLRule('static-query', './loaders/static-query')

  // plugins

  if (process.stdout.isTTY && !process.env.GRIDSOME_TEST) {
    config.plugin('progress')
      .use(require('webpack/lib/ProgressPlugin'))
  }

  config.plugin('vue-loader')
    .use(VueLoaderPlugin)

  config.plugin('case-sensitive-paths')
    .use(require('case-sensitive-paths-webpack-plugin'))

  // config.plugin('friendly-errors')
  //   .use(require('friendly-errors-webpack-plugin'))

  if (!isProd) {
    config.plugin('html')
      .use(require('html-webpack-plugin'), [{
        minify: true,
        templateContent () {
          return createHTMLRenderer(projectConfig.htmlTemplate)({
            app: '<div id="app"></div>'
          })
        }
      }])
  }

  config.plugin('injections')
    .use(require('webpack/lib/DefinePlugin'), [createEnv(projectConfig)])

  if (isProd && !isServer) {
    config.plugin('extract-css')
      .use(CSSExtractPlugin, [{
        filename: `${assetsDir}/css/styles${useHash ? '.[contenthash:8]' : ''}.css`
      }])

    config.optimization.splitChunks({
      cacheGroups: {
        data: {
          test: m => m.resource && m.request.startsWith(`${projectConfig.cacheDir}/data`),
          name: false,
          chunks: 'all',
          maxSize: 60000,
          minSize: 5000
        }
      }
    })
  }

  if (process.env.GRIDSOME_TEST) {
    config.optimization.minimize(false)
  }

  // helpes

  function createCacheOptions () {
    const values = {
      'gridsome': require('../../package.json').version,
      'cache-loader': require('cache-loader/package.json').version,
      'vue-loader': require('vue-loader/package.json').version,
      context: app.context,
      isProd,
      isServer,
      config: (
        (projectConfig.chainWebpack || '').toString()
      )
    }

    return {
      cacheDirectory: app.resolve('node_modules/.cache/gridsome'),
      cacheIdentifier: hash(values)
    }
  }

  function createGraphQLRule (type, loader) {
    const re = new RegExp(`blockType=(${type})`)

    config.module.rule(type)
      .resourceQuery(re)
      .use('babel-loader')
      .loader('babel-loader')
      .options({
        presets: [
          require.resolve('@vue/babel-preset-app')
        ]
      })
      .end()
      .use(`${type}-loader`)
      .loader(require.resolve(loader))
  }

  function createCSSRule (config, lang, test, loader = null, options = {}) {
    const { css = {}, postcss = {}} = projectConfig.css.loaderOptions
    const baseRule = config.module.rule(lang).test(test)
    const modulesRule = baseRule.oneOf('modules').resourceQuery(/module/)
    const normalRule = baseRule.oneOf('normal')

    applyLoaders(modulesRule, true)
    applyLoaders(normalRule, false)

    function applyLoaders (rule, modules) {
      if (!isServer) {
        if (isProd) {
          rule.use('extract-css-loader').loader(CSSExtractPlugin.loader)
        } else {
          rule.use('vue-style-loader').loader('vue-style-loader')
        }
      }

      rule.use('css-loader')
        .loader('css-loader')
        .options(Object.assign({
          modules,
          exportOnlyLocals: isServer,
          localIdentName: `[local]_[hash:base64:8]`,
          importLoaders: 1,
          sourceMap: !isProd
        }, css))

      rule.use('postcss-loader')
        .loader('postcss-loader')
        .options(Object.assign({
          sourceMap: !isProd
        }, postcss, {
          plugins: (postcss.plugins || []).concat(require('autoprefixer'))
        }))

      if (loader) {
        rule.use(loader).loader(loader).options(options)
      }
    }
  }

  function createEnv (projectConfig) {
    const baseEnv = {
      'process.env.PUBLIC_PATH': JSON.stringify(pathPrefix),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || ''),
      'GRIDSOME_CACHE_DIR': JSON.stringify(projectConfig.cacheDir),
      'GRIDSOME_DATA_DIR': JSON.stringify(`${projectConfig.cacheDir}/data`),
      'GRIDSOME_MODE': JSON.stringify(process.env.GRIDSOME_MODE || ''),
      'process.isClient': !isServer,
      'process.isServer': isServer,
      'process.isProduction': process.env.NODE_ENV === 'production'
    }

    // merge variables start with GRIDSOME_ENV to config.env
    const gridsomeEnv = pick(process.env, Object.keys(process.env).filter(key => key.startsWith('GRIDSOME_')))
    const mergeEnv = Object.entries(gridsomeEnv)
      .reduce((acc, [key, value]) => {
        acc[`process.env.${key}`] = ['boolean', 'number'].includes(typeof value) ? value : JSON.stringify(value)
        return acc
      }, {})

    return {
      ...baseEnv,
      ...mergeEnv
    }
  }

  return config
}
