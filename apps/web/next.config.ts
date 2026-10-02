import type {NextConfig} from 'next';
const devOrigin=process.env.MANDATE_APP_ORIGIN?new URL(process.env.MANDATE_APP_ORIGIN).host:undefined;
const config:NextConfig={allowedDevOrigins:devOrigin?[devOrigin]:[],transpilePackages:['@mandate/domain'],devIndicators:false,distDir:process.env.MANDATE_PRODUCTION_BUILD==='1'?'.next-production':'.next'};
export default config;
