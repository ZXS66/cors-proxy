// cors-proxy.ts
import express from 'express';
import axios from 'axios';
import cors from 'cors';
// import { createProxyMiddleware } from 'http-proxy-middleware';
import morgan from 'morgan';

// 创建 Express 应用
const app = express();
const PORT = +(process.env.PORT || 3000);

/** parse value as string array */
const parseStrings = (value: string | string[] | undefined): string[] => {
	if (typeof value === 'string') {
		return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
	}
	if (Array.isArray(value)) {
		return value.map(v => v.trim()).filter(v => v.length > 0);
	}
	return [];
}

/** parse value (any type) as boolean, returns false if value is not a boolean or string */
const parseBoolean = (value: string | boolean | undefined): boolean => {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		const trimValue = value.trim().toLowerCase();
		return trimValue === 'true' || trimValue === 't' || trimValue === '1' || trimValue === 'yes' || trimValue === 'y';
	}
	return false;
}

// ====================== 配置项 ======================
// 可根据需求修改以下配置
const CONFIG = {
	// 允许的来源，* 表示允许所有，也可以指定具体域名，多个以','分隔，如 https://johnzhu.cn,https://localhost:3000
	ALLOWED_HOSTS: parseStrings(process.env.ALLOWED_HOSTS || '*'),
	// 目标API域名（可选），如果设置则只允许代理到该域名，提高安全性
	TARGET_DOMAINS: parseStrings(process.env.TARGET_DOMAINS || ''),
	// 是否启用请求日志
	ENABLE_LOG: parseBoolean(process.env.ENABLE_LOG || 'true'),
	// 请求超时时间（毫秒）
	TIMEOUT: +(process.env.TIMEOUT || 30000)
};

// ====================== 中间件配置 ======================
// 启用JSON解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 启用日志
if (CONFIG.ENABLE_LOG) {
	app.use(morgan('combined'));
}

// CORS配置
// https://www.npmjs.com/package/cors#configuration-options
app.use(cors((
	req: express.Request,
	callback: (err: any, corsOptions?: any) => void
) => {
	if (CONFIG.ALLOWED_HOSTS?.length === 1 && CONFIG.ALLOWED_HOSTS[0] === '*') {
		return callback(null, true);
	}
	const origin = req.host;
	if (CONFIG.ALLOWED_HOSTS.includes(origin)) {
		return callback(null, { origin, credentials: true });
	} else {
		callback(new Error('unmatched origin: ' + origin));
	}
}));

// 处理OPTIONS预检请求
// Removed explicit OPTIONS route; CORS middleware handles OPTIONS requests.

// ====================== 核心代理逻辑 ======================
// 健康检查接口
app.get('/cors-proxy/health', (req: express.Request, res: express.Response) => {
	if (CONFIG.ALLOWED_HOSTS.includes(req.host)) {
		res.status(200).json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			port: PORT
		});
	} else {
		return res.status(403).json({
			error: 'Forbidden',
			message: 'Health check is not allowed from this origin'
		});
	}
});
// 通用代理接口
app.all(/^\/cors-proxy\/(.+)/, async (req: express.Request, res: express.Response) => {
	try {
		// 提取目标URL（去掉 /cors-proxy/ 前缀）
		let targetUrl = req.originalUrl.replace(/^\/cors-proxy\//, '');
		// 安全校验：如果配置了TARGET_DOMAINS，只允许代理到该域名列表中的域名
		if (CONFIG.TARGET_DOMAINS?.length) {
			const urlObj = new URL(targetUrl);
			if (!CONFIG.TARGET_DOMAINS.includes(urlObj.hostname)) {
				console.warn(`Blocked request to disallowed domain: ${urlObj.hostname}`);
				return res.status(403).json({
					error: 'Forbidden',
					message: `Only requests to ${CONFIG.TARGET_DOMAINS} are allowed`
				});
			}
		}
		console.log(`Proxying request to: ${targetUrl}`);

		// 构建请求配置
		const requestConfig = {
			method: req.method,
			url: targetUrl,
			headers: {
				...req.headers,
				// 移除可能导致问题的头信息
				host: new URL(targetUrl).hostname,
				'content-length': req.headers['content-length'] || undefined,
				'transfer-encoding': req.headers['transfer-encoding'] || undefined
			},
			data: req.body,
			timeout: CONFIG.TIMEOUT,
			// 允许重定向
			maxRedirects: 5,
			// 响应体处理
			responseType: 'stream' as ('arraybuffer' | 'document' | 'json' | 'text' | 'stream' | 'blob')
		};

		// 发送请求并转发响应
		const response = await axios(requestConfig);

		// 设置响应头
		Object.keys(response.headers).forEach(key => {
			res.setHeader(key, response.headers[key]);
		});

		// 设置状态码
		res.status(response.status);

		// 转发响应流
		response.data.pipe(res);

	} catch (error: any) {
		// 错误处理
		console.error('Proxy error:', error.message);
		res.status(error.response?.status || 500).json({
			error: 'Proxy Error',
			message: error.message,
			status: error.response?.status
		});
	}
});

// 启动服务器
app.listen(PORT, () => {
	console.log(`CORS Proxy Server running on port ${PORT}`);
	console.log(`Allowed Origins: ${CONFIG.ALLOWED_HOSTS}`);
	if (CONFIG.TARGET_DOMAINS?.length) {
		console.log(`Restricted to target domains: ${CONFIG.TARGET_DOMAINS}`);
	}
	console.log(`Server started at: ${new Date().toISOString()}`);
});

// 优雅关闭
process.on('SIGINT', () => {
	console.log('\nShutting down proxy server...');
	process.exit(0);
});
