const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const WooCommerceDependencyExtractionWebpackPlugin = require( '@woocommerce/dependency-extraction-webpack-plugin' );
const MiniCssExtractPlugin = require( 'mini-css-extract-plugin' );
const TerserJSPlugin = require( 'terser-webpack-plugin' );
const OptimizeCssAssetsPlugin = require( 'optimize-css-assets-webpack-plugin' );
const { omit } = require( 'lodash' );
const fs = require("fs");
const CopyWebpackPlugin = require( 'copy-webpack-plugin' );
const glob = require( 'glob' );
const { paramCase } = require( 'change-case' );

// This is a simple webpack plugin to delete the JS files generated by MiniCssExtractPlugin.

function RemoveFilesPlugin( filePath = '' ) {
    this.filePath = filePath;
}

RemoveFilesPlugin.prototype.apply = function ( compiler ) {
    compiler.hooks.afterEmit.tap( 'afterEmit', () => {
        const files = glob.sync( this.filePath );
        files.forEach( ( f ) => {
            fs.unlink( f, ( err ) => {
                if ( err ) {
                    /* eslint-disable-next-line no-console */
                    console.log( `There was an error removing ${ f }.`, err );
                }
            } );
        } );
    } );
};

function findModuleMatch( module, match ) {
    if ( module.request && match.test( module.request ) ) {
        return true;
    } else if ( module.issuer ) {
        return findModuleMatch( module.issuer, match );
    }
    return false;
}

// Remove SASS rule from the default config so we can define our own.
const defaultRules = defaultConfig.module.rules.filter( ( rule ) => {
    return String( rule.test ) !== String( /\.(sc|sa)ss$/ );
} );

const blocks = {
    'checkout': {},
    'cart': {}
};

const getBlockEntries = ( relativePath ) => {
    return Object.fromEntries(
        Object.entries( blocks )
            .map( ( [ blockCode, config ] ) => {
                const filePaths = glob.sync(
                    `./assets/js/blocks/${ config.customDir || blockCode }/` +
                    relativePath
                );
                if ( filePaths.length > 0 ) {
                    return [ blockCode, filePaths ];
                }
                return null;
            } )
            .filter( Boolean )
    );
};

const entries = {
    styling: {
        // Shared blocks code
        'wc-shipments-blocks': './assets/js/index.js',
        ...getBlockEntries( '{index,block,frontend}.{t,j}s{,x}' ),
    },
    main: {
        // Shared blocks code
        'wc-shipments-blocks': './assets/js/index.js',
        // Blocks
        ...getBlockEntries( 'index.{t,j}s{,x}' )
    },
    frontend: {
        ...getBlockEntries( 'frontend.{t,j}s{,x}' ),
    },
    'static': {
        'admin-styles': './assets/css/admin.scss',
        'admin-shipment': './assets/js/static/admin-shipment.js',
        'admin-shipment-modal': './assets/js/static/admin-shipment-modal.js',
        'admin-shipments': './assets/js/static/admin-shipments.js',
        'admin-shipments-table': './assets/js/static/admin-shipments-table.js',
        'admin-shipping-provider-method': './assets/js/static/admin-shipping-provider-method.js',
        'admin-shipping-providers': './assets/js/static/admin-shipping-providers.js',
    },
};

const getEntryConfig = ( type = 'main', exclude = [] ) => {
    return omit( entries[ type ], exclude );
};

const getAlias = ( options = {} ) => {
    return {
        '@shipments/base-components': path.resolve(
            __dirname,
            `/assets/js/base/components/`
        ),
    };
};

const wcDepMap = {
    '@woocommerce/blocks-registry': [ 'wc', 'wcBlocksRegistry' ],
    '@woocommerce/settings': [ 'wc', 'wcSettings' ],
    '@woocommerce/block-data': [ 'wc', 'wcBlocksData' ],
    '@woocommerce/data': [ 'wc', 'data' ],
    '@woocommerce/shared-context': [ 'wc', 'wcBlocksSharedContext' ],
    '@woocommerce/shared-hocs': [ 'wc', 'wcBlocksSharedHocs' ],
    '@woocommerce/price-format': [ 'wc', 'priceFormat' ],
    '@woocommerce/blocks-checkout': [ 'wc', 'blocksCheckout' ],
    '@woocommerce/interactivity': [ 'wc', '__experimentalInteractivity' ]
};

const wcHandleMap = {
    '@woocommerce/blocks-registry': 'wc-blocks-registry',
    '@woocommerce/settings': 'wc-settings',
    '@woocommerce/block-data': 'wc-blocks-data-store',
    '@woocommerce/data': 'wc-store-data',
    '@woocommerce/shared-context': 'wc-blocks-shared-context',
    '@woocommerce/shared-hocs': 'wc-blocks-shared-hocs',
    '@woocommerce/price-format': 'wc-price-format',
    '@woocommerce/blocks-checkout': 'wc-blocks-checkout',
    '@woocommerce/interactivity': 'wc-interactivity'
};

const requestToExternal = ( request ) => {
    if ( wcDepMap[ request ] ) {
        return wcDepMap[ request ];
    }
};

const requestToHandle = ( request ) => {
    if ( wcHandleMap[ request ] ) {
        return wcHandleMap[ request ];
    }
};

const StaticConfig = {
    ...defaultConfig,
    entry: getEntryConfig( 'static', [] ),
    optimization: {
        minimizer: [new TerserJSPlugin({extractComments: false}), new OptimizeCssAssetsPlugin({})],
        minimize: true,
    },
    module:  {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
            },
            {
                test: /\.(scss|css)$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                    'postcss-loader',
                    'sass-loader'
                ],
            },
        ],
    },
    resolve: {
        extensions: ['.js', '.css', '.scss']
    },
    output: {
        path: path.resolve( __dirname, './build/static/' ),
        filename: "[name].js",
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
    ]
};

const MainConfig = {
    ...defaultConfig,
    entry: getEntryConfig( 'main', [] ),
    output: {
        devtoolNamespace: 'wcShipments',
        path: path.resolve( __dirname, 'build/' ),
        // This is a cache busting mechanism which ensures that the script is loaded via the browser with a ?ver=hash
        // string. The hash is based on the built file contents.
        // @see https://github.com/webpack/webpack/issues/2329
        // Using the ?ver string is needed here so the filename does not change between builds. The WordPress
        // i18n system relies on the hash of the filename, so changing that frequently would result in broken
        // translations which we must avoid.
        // @see https://github.com/Automattic/jetpack/pull/20926
        chunkFilename: `[name].js?ver=[contenthash]`,
        filename: `[name].js`,
        library: [ 'wcShipments', 'blocks', '[name]' ],
        libraryTarget: 'window',
        // This fixes an issue with multiple webpack projects using chunking
        // overwriting each other's chunk loader function.
        // See https://webpack.js.org/configuration/output/#outputjsonpfunction
        // This can be removed when moving to webpack 5:
        // https://webpack.js.org/blog/2020-10-10-webpack-5-release/#automatic-unique-naming
        chunkLoadingGlobal: 'webpackWcShipmentsBlocksJsonp'
    },
    module: {
        ...defaultConfig.module,
        rules: [
            ...defaultRules,
            {
                test: /\.js$/,
                exclude: /node_modules/,
            },
            {
                test: /\.(sc|sa)ss$/,
                exclude: /node_modules/,
                use: [
                    MiniCssExtractPlugin.loader,
                    { loader: 'css-loader', options: { importLoaders: 1 } },
                    {
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                includePaths: [ 'assets/css' ],
                            },
                            additionalData: ( content, loaderContext ) => {
                                const {
                                    resourcePath,
                                    rootContext,
                                } = loaderContext;
                                const relativePath = path.relative(
                                    rootContext,
                                    resourcePath
                                );

                                if (
                                    relativePath.startsWith( 'assets/css/' )
                                ) {
                                    return content;
                                }

                                // Add code here to prepend to all .scss/.sass files.
                                return (
                                    content
                                );
                            },
                        },
                    },
                ],
            },
        ],
    },
    resolve: {
        alias: getAlias()
    },
    plugins: [
        ...defaultConfig.plugins.filter(
            ( plugin ) =>
                plugin.constructor.name !== 'DependencyExtractionWebpackPlugin'
        ),
        new WooCommerceDependencyExtractionWebpackPlugin( {
            requestToExternal,
            requestToHandle,
        } ),
        new MiniCssExtractPlugin( {
            filename: `[name].css`,
        } ),
        new CopyWebpackPlugin( {
            patterns: [
                {
                    from: './assets/js/**/block.json',
                    to( { absoluteFilename } ) {
                        /**
                         * Getting the block name from the JSON metadata is less error prone
                         * than extracting it from the file path.
                         */
                        const JSONFile = fs.readFileSync(
                            path.resolve( __dirname, absoluteFilename )
                        );
                        const metadata = JSON.parse( JSONFile.toString() );

                        const blockName = metadata.name
                            .split( '/' )
                            .at( 1 );

                        if ( metadata.parent )
                            return `./inner-blocks/${ blockName }/block.json`;
                        return `./${ blockName }/block.json`;
                    },
                },
            ],
        } ),
    ],
};

const FrontendConfig = {
    ...defaultConfig,
    entry: getEntryConfig( 'frontend', [] ),
    module: {
        ...defaultConfig.module,
        rules: [
            ...defaultRules,
            {
                test: /\.(sc|sa)ss$/,
                exclude: /node_modules/,
                use: [
                    MiniCssExtractPlugin.loader,
                    { loader: 'css-loader', options: { importLoaders: 1 } },
                    {
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                includePaths: [ 'assets/css' ],
                            },
                            additionalData: ( content, loaderContext ) => {
                                const {
                                    resourcePath,
                                    rootContext,
                                } = loaderContext;
                                const relativePath = path.relative(
                                    rootContext,
                                    resourcePath
                                );

                                if (
                                    relativePath.startsWith( 'assets/css/' )
                                ) {
                                    return content;
                                }

                                // Add code here to prepend to all .scss/.sass files.
                                return (
                                    content
                                );
                            },
                        },
                    },
                ],
            },
        ],
    },
    output: {
        devtoolNamespace: 'wcShipments',
        path: path.resolve( __dirname, 'build/' ),
        // This is a cache busting mechanism which ensures that the script is loaded via the browser with a ?ver=hash
        // string. The hash is based on the built file contents.
        // @see https://github.com/webpack/webpack/issues/2329
        // Using the ?ver string is needed here so the filename does not change between builds. The WordPress
        // i18n system relies on the hash of the filename, so changing that frequently would result in broken
        // translations which we must avoid.
        // @see https://github.com/Automattic/jetpack/pull/20926
        chunkFilename: `[name]-frontend.js?ver=[contenthash]`,
        filename: `[name]-frontend.js`,
        // This fixes an issue with multiple webpack projects using chunking
        // overwriting each other's chunk loader function.
        // See https://webpack.js.org/configuration/output/#outputjsonpfunction
        // This can be removed when moving to webpack 5:
        // https://webpack.js.org/blog/2020-10-10-webpack-5-release/#automatic-unique-naming
        chunkLoadingGlobal: 'webpackWcShipmentsBlocksJsonp',
    },
    resolve: {
        alias: getAlias()
    },
    plugins: [
        ...defaultConfig.plugins.filter(
            ( plugin ) =>
                plugin.constructor.name !== 'DependencyExtractionWebpackPlugin'
        ),
        new WooCommerceDependencyExtractionWebpackPlugin( {
            requestToExternal,
            requestToHandle,
        } ),
        new MiniCssExtractPlugin( {
            filename: `[name].css`,
        } ),
    ],
};

const StylingConfig = {
    ...defaultConfig,
    entry: getEntryConfig( 'styling' ),
    optimization: {
        splitChunks: {
            minSize: 0,
            automaticNameDelimiter: '--',
            cacheGroups: {
                editorStyle: {
                    // Capture all `editor` stylesheets and editor-components stylesheets.
                    test: ( module = {} ) =>
                        module.constructor.name === 'CssModule' &&
                        ( findModuleMatch( module, /editor\.scss$/ ) ||
                            findModuleMatch(
                                module,
                                /[\\/]assets[\\/]js[\\/]editor-components[\\/]/
                            ) ),
                    name: 'wc-shipments-blocks-editor-style',
                    chunks: 'all',
                    priority: 10,
                },
            },
        },
    },
    module: {
        ...defaultConfig.module,
        rules: [
            ...defaultRules,
            {
                test: /\.(sc|sa)ss$/,
                exclude: /node_modules/,
                use: [
                    MiniCssExtractPlugin.loader,
                    { loader: 'css-loader', options: { importLoaders: 1 } },
                    {
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                includePaths: [ 'assets/css' ],
                            },
                            additionalData: ( content, loaderContext ) => {
                                const {
                                    resourcePath,
                                    rootContext,
                                } = loaderContext;
                                const relativePath = path.relative(
                                    rootContext,
                                    resourcePath
                                );

                                if (
                                    relativePath.startsWith( 'assets/css/' )
                                ) {
                                    return content;
                                }

                                // Add code here to prepend to all .scss/.sass files.
                                return (
                                    content
                                );
                            },
                        },
                    },
                ],
            },
        ],
    },
    output: {
        devtoolNamespace: 'wcShipments',
        path: path.resolve( __dirname, 'build/' ),
        filename: `[name]-style.js`,
        library: [ 'wcShipments', 'blocks', '[name]' ],
        libraryTarget: 'window',
        // This fixes an issue with multiple webpack projects using chunking
        // overwriting each other's chunk loader function.
        // See https://webpack.js.org/configuration/output/#outputjsonpfunction
        // This can be removed when moving to webpack 5:
        // https://webpack.js.org/blog/2020-10-10-webpack-5-release/#automatic-unique-naming
        chunkLoadingGlobal: 'webpackWcShipmentsBlocksJsonp'
    },
    resolve: {
        alias: getAlias(),
        extensions: [ '.js' ],
    },
    plugins: [
        ...defaultConfig.plugins.filter(
            ( plugin ) =>
                plugin.constructor.name !== 'DependencyExtractionWebpackPlugin'
        ),
        new WooCommerceDependencyExtractionWebpackPlugin( {
            requestToExternal,
            requestToHandle,
        } ),
        new MiniCssExtractPlugin( {
            filename: `[name].css`,
        } ),
        // Remove JS files generated by MiniCssExtractPlugin.
        new RemoveFilesPlugin( `./build/*style.js` ),
    ],
};

module.exports = [
    StaticConfig,
    // MainConfig,
    FrontendConfig,
    StylingConfig
];