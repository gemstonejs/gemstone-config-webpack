/*
**  GemstoneJS -- Gemstone JavaScript Technology Stack
**  Copyright (c) 2016-2018 Gemstone Project <http://gemstonejs.com>
**  Licensed under Apache License 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

const path              = require("path")
const fs                = require("mz/fs")
const rimraf            = require("rimraf")
const gemstoneConfig    = require("gemstone-config")
const webpack           = require("webpack")
const BundleAnalyzer    = require("webpack-bundle-analyzer").BundleAnalyzerPlugin
const ExtractTextPlugin = require("extract-text-webpack-plugin")
const HTMLWebpackPlugin = require("html-webpack-plugin")
const PreBuildPlugin    = require("pre-build-webpack")
const OnBuildPlugin     = require("on-build-webpack")
const FaviconsPlugin    = require("favicons-webpack-plugin")
const CompressionPlugin = require("compression-webpack-plugin")
const BrotliPlugin      = require("brotli-webpack-plugin")
const Chalk             = require("chalk")
const Progress          = require("progress")
const stripIndent       = require("strip-indent")
const jsBeautify        = require("js-beautify")
const hashFiles         = require("hash-files")
const Moment            = require("moment")

module.exports = function (opts) {
    /*  determine Gemstone configuration  */
    let cfg = gemstoneConfig()

    /*  get a chalk instance  */
    const chalk = new Chalk.constructor({ enabled: true })

    /*  instanciate progress bar  */
    let progressCur = 0.0
    let progressBar = new Progress(`   compiling: [${chalk.green(":bar")}] ${chalk.bold(":percent")} (elapsed: :elapseds) :msg `, {
        complete:   "#",
        incomplete: "=",
        width:      20,
        total:      1.0,
        stream:     process.stderr
    })

    /*  generate HTML index page skeleton  */
    let index = stripIndent(`
        <!DOCTYPE html>
        <!--
        %header%
        -->
        <html>
            <head>
                <meta http-equiv="content-type" content="text/html; charset=utf-8">
                <meta http-equiv="X-UA-Compatible" content="IE=edge">
                <meta name="viewport" content="width=device-width, minimum-scale=1, initial-scale=1, maximum-scale=1, user-scalable=no">
                <meta name="mobile-web-app-capable" content="yes">
                <meta name="apple-mobile-web-app-capable" content="yes">
                <meta name="apple-touch-fullscreen" content="yes">
                <meta name="robots" content="noindex, nofollow, noarchive">
                <meta name="generator" content="Gemstone">
                <title>${cfg.meta.title}</title>
                <meta name="description" content="${cfg.meta.description}">
                <meta name="author" content="${cfg.meta.author}">
                <meta name="keywords" content="${cfg.meta.keywords}">
            </head>
            <body>
            </body>
        </html>
    `  ).replace(/%header%\n/, cfg.header !== "" ? cfg.header : "    Gemstone Application")
        .replace(/^\n+/, "")
        .replace(/([ \t]*\n)+[ \t]*$/, "\n")

    /*  determine resolved path to source files  */
    let sourceResolved   = path.resolve(cfg.path.source)
    let resourceResolved = path.resolve(cfg.path.resource)

    /*  the SVG image/font checking cache  */
    const svgIsFont = (() => {
        let isFontCache = {}
        return (path) => {
            let isFont = isFontCache[path]
            if (isFont === undefined) {
                let svg = fs.readFileSync(path, "utf8")
                isFont = (svg.match(/<font[^>]*>(.|\r?\n)*<\/font>/) !== null)
                isFontCache[path] = true
            }
            return isFont
        }
    })()

    /*  start assembling Webpack configuration object  */
    let pathSepRe = path.sep.replace(/\\/, "\\\\")
    let config = {
        plugins: [
            new webpack.NoEmitOnErrorsPlugin(),
            new ExtractTextPlugin({
                filename:  "[name].css",
                allChunks: true
            }),
            new webpack.optimize.CommonsChunkPlugin({
                name: "lib",
                minChunks: function (module) {
                    return (
                        module.context && (module.context.match(/(?:node_modules|bower_components)/)
                        || module.context.match(/gemstone-framework-frontend/))
                    )
                }
            }),
            new HTMLWebpackPlugin({
                templateContent: index,
                filename:       "index.html",
                inject:         "head",
                title:          cfg.meta.title,
                chunksSortMode: "dependency",
                cache:          true
            }),
            new FaviconsPlugin({
                logo:             (cfg.path.icon !== "" ? cfg.path.icon : path.resolve(path.join(__dirname, "gemstone-icon.png"))),
                prefix:           "index-",
                emitStats:        false,
                persistentCache:  opts.env === "development",
                inject:           true,
                background:       "#ffffff",
                title:            cfg.meta.title,
                icons: {
                    android:      true,
                    appleIcon:    true,
                    appleStartup: false,
                    favicons:     true,
                    firefox:      false,
                    coast:        false,
                    opengraph:    false,
                    twitter:      false,
                    yandex:       false,
                    windows:      false
                }
            }),
            new webpack.BannerPlugin({
                banner:    cfg.header,
                raw:       false,
                entryOnly: true
            }),
            new webpack.ProgressPlugin((percentage, msg) => {
                if (msg.length > 40)
                    msg = msg.substr(0, 40) + "..."
                let delta = percentage - progressCur
                progressBar.tick(delta, { msg })
                if (progressBar.complete)
                    process.stderr.write("\n")
                progressCur += delta
            }),
            new PreBuildPlugin(async (/* stats */) => {
                if (opts.env === "production") {
                    /*  remove destination directory (recursively)  */
                    if (await fs.exists(cfg.path.output)) {
                        await new Promise((resolve, reject) => {
                            rimraf(cfg.path.output, {}, (err) => {
                                if (err) reject(err)
                                else     resolve()
                            })
                        })
                    }
                }
            }),
            new OnBuildPlugin(async (/* stats */) => {
                /*  remove unwanted generated file  */
                let manifest = path.join(cfg.path.output, "index-manifest.json")
                if (await fs.exists(manifest))
                    await fs.unlink(manifest)

                /*  reformat index.html file  */
                let filename = path.join(cfg.path.output, "index.html")
                if (await fs.exists(filename)) {
                    let html = await fs.readFile(filename, "utf8")
                    html = jsBeautify.html(html, {
                        indent_size: 4,
                        indent_char: " ",
                        indent_inner_html: true,
                        extra_liners: []
                    })
                    await fs.writeFile(filename, html, "utf8")
                }
            }),
            new webpack.optimize.ModuleConcatenationPlugin()
        ],
        context: process.cwd(),
        entry: {
            "app": cfg.path.main
        },
        resolve: {
            modules: cfg.modules.source.concat([
                cfg.path.source,
                "node_modules",
                "bower_components"
            ]),
            descriptionFiles: [
                "package.json",
                "bower.json"
            ],
            mainFields: [
                "browser",
                "main"
            ],
            alias: {
                "gemstone$":        `gemstone-framework-frontend/dst/gemstone${opts.env === "production" ? "" : ".dev"}.js`,
                "gemstone.css$":    "gemstone-framework-frontend/dst/gemstone.css",
                "jquery$":          "gemstone-framework-frontend/lib/jquery",
                "vue$":             "gemstone-framework-frontend/lib/vue",
                "componentjs$":     "gemstone-framework-frontend/lib/componentjs"
            }
        },
        externals: [{
            "navigator":    "navigator",
            "window":       "window",
            "document":     "document",
            "websocket":    "WebSocket"
        }],
        module: {
            noParse: new RegExp(`${pathSepRe}gemstone-framework-frontend${pathSepRe}$`),
            rules: [
                /*  ==== LIB ====  */
                {
                    test: (path) => {
                        return path.match(new RegExp(`${pathSepRe}(?:node_modules|bower_components)${pathSepRe}`))
                            || (path.indexOf(resourceResolved) === 0)
                    },
                    rules: [
                        /*  JavaScript  */
                        {   test: /\.js$/,
                            rules: [
                                {
                                    parser: {
                                        amd: false,
                                        commonjs: true
                                    }
                                }
                            ]
                        },
                        /*  post-loader: remove strictness indicators  */
                        {   test: /\.js$/,
                            enforce: "post",
                            use: {
                                loader: require.resolve("gemstone-loader-nostrict")
                            }
                        },
                        /*  CSS/LESS  */
                        {   test: /\.css$/,
                            use: ExtractTextPlugin.extract({
                                fallback: require.resolve("style-loader"),
                                use: require.resolve("css-loader")
                            })
                        },
                        /*  JPEG/PNG/GIF images  */
                        {   test: /\.(?:jpg|png|gif)$/,
                            use: {
                                loader: require.resolve("file-loader"),
                                options: "name=lib-img-[md5:hash:base62:32].[ext]"
                            }
                        },
                        /*  SVG images/fonts  */
                        {   test: /\.svg$/,
                            rules: [ {
                                test: (path) => !svgIsFont(path),
                                use: {
                                    loader: require.resolve("file-loader"),
                                    options: "name=lib-img-[md5:hash:base62:32].[ext]"
                                }
                            }, {
                                test: (path) => svgIsFont(path),
                                use: {
                                    loader: require.resolve("file-loader"),
                                    options: "name=lib-font-[md5:hash:base62:32].[ext]"
                                }
                            } ]
                        },
                        /*  EOT/WOFF/TTF fonts  */
                        {   test: /\.(?:eot|woff2?|ttf)$/,
                            use: {
                                loader: require.resolve("file-loader"),
                                options: "name=lib-font-[md5:hash:base62:32].[ext]"
                            }
                        },
                        /*  TXT/BIN files  */
                        {   test: /\.(?:txt|bin)$/,
                            use: require.resolve("raw-loader")
                        }
                    ]
                },

                /*  ==== APP ====  */
                {
                    test: (path) => {
                        return (path.indexOf(sourceResolved) === 0)
                    },
                    rules: [
                        /*  pre-loader: Unique Component Identifier (UCID)  */
                        {   test: /\.(?:js|tsx?|html|yaml|css|svg)$/,
                            enforce: "pre",
                            use: {
                                loader: require.resolve("gemstone-loader-ucid"),
                                options: {
                                    sourceDir: sourceResolved,
                                    idMatch:   "__ucid",
                                    idReplace: "ucid<ucid>"
                                }
                            }
                        },
                        /*  JavaScript  */
                        {   test: /\.js$/,
                            exclude: (path) => {
                                return (path.match(/(?:node_modules|bower_components)/))
                            },
                            use: require.resolve("gemstone-loader-js")
                        },
                        /*  TypeScript  */
                        {   test: /\.tsx?$/,
                            exclude: (path) => {
                                return (path.match(/(?:node_modules|bower_components)/))
                            },
                            use: {
                                loader: require.resolve("gemstone-loader-ts"),
                                options: {
                                    transpileOnly: true,
                                    silent: true
                                }
                            }
                        },
                        /*  HTML  */
                        {   test: /\.html$/,
                            use: require.resolve("gemstone-loader-html")
                        },
                        /*  YAML  */
                        {   test: /\.yaml$/,
                            use: require.resolve("gemstone-loader-yaml")
                        },
                        /*  CSS/LESS  */
                        {   test: /\.css$/,
                            use: ExtractTextPlugin.extract({
                                fallback: require.resolve("style-loader"),
                                use: require.resolve("gemstone-loader-css")
                            })
                        },
                        /*  JPEG/PNG/SVG images
                            (should not be used due to inline-assets in gemstone-loader-{css,html}  */
                        {   test: /\.(?:jpg|png|gif)$/,
                            use: {
                                loader: require.resolve("file-loader"),
                                options: "name=app-img-[md5:hash:base62:32].[ext]"
                            }
                        },
                        /*  SVG images/fonts
                            (should not be used due to inline-assets in gemstone-loader-{css,html}  */
                        {   test: /\.svg$/,
                            rules: [ {
                                test: (path) => !svgIsFont(path),
                                use: {
                                    loader: require.resolve("file-loader"),
                                    options: "name=app-img-[md5:hash:base62:32].[ext]"
                                }
                            }, {
                                test: (path) => svgIsFont(path),
                                use: {
                                    loader: require.resolve("file-loader"),
                                    options: "name=app-font-[md5:hash:base62:32].[ext]"
                                }
                            } ]
                        },
                        /*  EOT/WOFF/TTF fonts
                            (should not be used due to inline-assets in gemstone-loader-{css,html}  */
                        {   test: /\.(?:eot|woff2?|ttf)$/,
                            use: {
                                loader: require.resolve("file-loader"),
                                options: "name=app-font-[md5:hash:base62:32].[ext]"
                            }
                        },
                        /*  TXT/BIN files  */
                        {   test: /\.(?:txt|bin)$/,
                            use: require.resolve("raw-loader")
                        }
                    ]
                }
            ]
        },
        target: "web",
        output: {
            path:              path.resolve(cfg.path.output),
            filename:          "[name].js",
            libraryTarget:     "var",
            library:           "App",
            publicPath:        ""
        },
        stats: {
            colors:          chalk.supportsColor,
            hash:            false,
            version:         false,
            timings:         false,
            warnings:        false,
            errors:          true,
            errorDetails:    true,

            assets:          false,
            assetsSort:      "chunks",
            children:        false,
            cached:          false,
            cachedAssets:    false,

            entrypoints:     true,

            chunks:          true,
            chunkModules:    true,
            chunkOrigins:    false,
            chunksSort:      "",

            modules:         true,
            modulesSort:     "",
            maxModules:      Infinity,
            exclude:         [ "node_modules", "bower_components" ],
            usedExports:     false,
            providedExports: false,
            performance:     true,
            publicPath:      false,
            reasons:         false,
            source:          false
        }
    }

    /*  provide Webpack module aliasing  */
    cfg.modules.alias.forEach((alias) => {
        config.resolve.alias[alias.from] = alias.to
    })

    /*  provide Webpack module loaders  */
    cfg.modules.rules.forEach((rule) => {
        let uses = []
        Object.keys(rule.use).forEach((use) => {
            uses.push({
                loader: require.resolve(`${use}-loader`),
                options: rule.use[use]
            })
        })
        config.module.rules[0].rules.unshift({
            test: new RegExp(rule.test),
            use: uses
        })
    })

    /*  provide Webpack module provides  */
    let provides = {
        "jQuery":      "jquery",
        "Vue":         "vue",
        "ComponentJS": "componentjs"
    }
    cfg.modules.provide.forEach((provide) => {
        provides[provide.name] = provide.require
    })
    config.plugins.push(new webpack.ProvidePlugin(provides))

    /*  provide Webpack module replacements  */
    cfg.modules.replace.forEach((replace) => {
        let from = new RegExp(replace.match)
        let to   = replace.replace
        if (typeof to === "object" && to instanceof Array) {
            let substs = to
            to = function (resource) {
                substs.forEach((subst) => {
                    resource.request = resource.request.replace(new RegExp(subst[0]), subst[1])
                })
            }
        }
        config.plugins.push(new webpack.NormalModuleReplacementPlugin(from, to))
    })

    /*  determine build hash ("HHHH.HHHH.HHHH.HHHH")  */
    let hash = hashFiles.sync({
        files: [ `${sourceResolved}/**/*` ],
        algorithm: "md5"
    })
    hash = hash.toUpperCase()
        .split("").filter((x, i) => i % 2 === 0).join("")
        .replace(/([0-9A-F]{4})(?=.)/g, "$1.")

    /*  determine build time ("YYYY.MMDD.hhmm.ssSS")  */
    let time = Moment(new Date()).format("YYYY.MMDD.hhmm.ssSS")

    /*  provide environment information  */
    config.plugins.push(new webpack.DefinePlugin({
        "process.env": {
            "NODE_ENV":  `"${opts.env}"`
        },
        "process.config": {
            "env":      `"${opts.env}"`,
            "tag":      `"${opts.tag}"`,
            "hash":     `"${hash}"`,
            "time":     `"${time}"`
        }
    }))

    /*  final environment-specific treatments  */
    if (opts.env === "production") {
        /*  minimize JS files  */
        config.plugins.push(new webpack.optimize.UglifyJsPlugin({
            sourceMap: false,
            beautify:  false,
            comments:  false,
            mangle:    false,
            compress: {
                warnings: false
            }
        }))

        /*  minimize any other files (in general)  */
        config.plugins.push(new webpack.LoaderOptionsPlugin({
            minimize: true
        }))

        /*  compress JS/CSS/HTML files  */
        config.plugins.push(new CompressionPlugin({
            asset:      "[path].gz[query]",
            algorithm:  "gzip",
            test:       /\.(?:js|css|html)$/,
            threshold:  10 * 1024,
            minRatio:   0.8,
            deleteOriginalAssets: false
        }))
        config.plugins.push(new BrotliPlugin({
            asset:      "[path].br[query]",
            test:       /\.(?:js|css|html)$/,
            threshold:  10 * 1024,
            minRatio:   0.8
        }))
    }
    else {
        /*  do NOT minimize any files  */
        config.plugins.push(new webpack.LoaderOptionsPlugin({
            minimize: false
        }))

        /*  provide bundle analyzer information  */
        config.plugins.push(new BundleAnalyzer({
            analyzerMode:      "static",
            reportFilename:    "index-report.html",
            defaultSizes:      "parsed",
            openAnalyzer:      false,
            generateStatsFile: false,
            logLevel:          "error"
        }))

        /*  provide source-maps for debugging  */
        config.plugins.push(new webpack.SourceMapDevToolPlugin({
            test: /app\.(?:css|js)$/,
            filename: "[file].map"
        }))
    }

    return config
}

