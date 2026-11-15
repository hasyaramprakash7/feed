// index.js
const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const axios = require("axios");
const bodyParser = require("body-parser");
const startCronJobs = require('./utils/cronJobs');

const pushRoutes = require('./routes/pushRoutes');
const { router: subscriptionRouter, webhookRouter: subscriptionWebhook } = require('./routes/subscriptionRoutes');

connectDB();
startCronJobs();

const app = express();
const server = http.createServer(app);

// ==========================================================
// ✅ CORS — reflect ANY origin so credentials + wildcard works
// ==========================================================
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    return callback(null, origin);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
    "x-client-version",
    "x-client-platform",
    "x-app-version",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ✅ Express 5 no longer accepts '*' as a path — use a middleware instead.
//    This answers every OPTIONS preflight with the CORS headers above.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return cors(corsOptions)(req, res, next);
  }
  next();
});

// ==========================================================
// RAW BODY MIDDLEWARE FOR WEBHOOKS
// ==========================================================
app.use(
  '/api/orders/razorpay/secure-webhook',
  bodyParser.raw({ type: 'application/json' })
);

app.use(
  '/api/subscription/webhook',
  subscriptionWebhook
);

// ==========================================================
// STANDARD MIDDLEWARE
// ==========================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// ==========================================================
// 🚀 GLOBAL REQUEST LOGGER
// ==========================================================
app.use((req, res, next) => {
  try {
    console.log(`\n🔍 [${req.method}] ${req.url}`);
    console.log('  Origin        :', req.headers.origin || 'none');
    console.log('  Content-Type  :', req.headers['content-type'] || 'none');
    console.log('  Content-Length:', req.headers['content-length'] || 'none');

    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      console.log('  Body (parsed): [multipart — handled by multer]');
    } else if (req.body === undefined || req.body === null) {
      console.log('  Body (parsed): <empty>');
    } else {
      let bodyStr = '';
      try {
        bodyStr = JSON.stringify(req.body);
        if (typeof bodyStr !== 'string') bodyStr = String(req.body);
      } catch (e) {
        bodyStr = '[unserializable body]';
      }
      console.log('  Body (parsed):', bodyStr.slice(0, 500));
    }
  } catch (logErr) {
    console.error('❌ Logger middleware error:', logErr?.message);
  }
  next();
});

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "public/images")));
app.use("/imgdrink", express.static(path.join(__dirname, "public/imgdrink")));

// ==========================================================
// ROUTES
// ==========================================================
const vendorProductRouter = require('./routes/vendorProductRoutes');
const insuranceProductRouter = require('./routes/insuranceProductRoutes');
const appointmentRouter = require('./routes/appointmentRoutes');
const cartRouter = require("./routes/cartRouter");
const orderRoutes = require("./routes/orderRoutes");
const deliveryBoyRoutes = require("./routes/deliveryBoyRoutes");
const locationRoutes = require("./routes/locationRoutes");
const chatRoutes = require("./routes/chatRoutes");
const propertyRoutes = require("./routes/property.routes.js");
const rentalRoutes = require('./routes/Rental.routes');

const aiRoutes = require("./routes/aiRoutes");
const groupRoutes = require("./routes/groupRoutes.js");
const statusRoutes = require("./routes/status");
const addressRoutes = require("./routes/addressRoutes");

const categoryRoutes = require('./routes/category');
const reviewRoutes = require('./routes/review');
const leadRoutes = require('./routes/lead');
const adRoutes = require('./routes/ad');
const uploadRoutes = require('./routes/uploadRoutes');
app.use('/api/upload', uploadRoutes);

console.log('📦 Registering rental routes at /api/v1/rentals');
app.use('/api/v1/rentals', rentalRoutes);

console.log('📦 Registering property routes at /api/v1/properties');
app.use('/api/v1/properties', propertyRoutes);

app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/control", require("./routes/controlRoutes"));
app.use("/api/vendors", require("./routes/vendorRouter"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/vendor-products', vendorProductRouter);
app.use('/api/products', insuranceProductRouter);
app.use("/api/appointments", appointmentRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", orderRoutes);
app.use("/api/deliveryboy", deliveryBoyRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/group", groupRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/addresses", addressRoutes);
app.use('/api/product-views', require('./routes/productViewRoutes'));

app.use('/api/push', pushRoutes);
app.use('/api/subscription', subscriptionRouter);

app.use('/api/categories', categoryRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/ads', adRoutes);

app.get("/", (req, res) => {
  res.send("🚀 API is running...");
});

app.get("/api/ip-location", async (req, res) => {
  try {
    let ip = req.headers["x-forwarded-for"]?.split(",")[0] ||
             req.socket?.remoteAddress ||
             req.connection?.remoteAddress;
    if (ip === "::1" || ip.startsWith("::ffff:127.")) ip = "";
    const response = await axios.get(`https://ipapi.co/${ip}/json/`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Failed to get IP location" });
  }
});

// ==========================================================
// 🔴 GLOBAL ERROR HANDLER
// ==========================================================
app.use((err, req, res, next) => {
  console.error('\n══════════ GLOBAL ERROR HANDLER ══════════');
  console.error('❌ URL       :', req.method, req.originalUrl);
  console.error('❌ name      :', err?.name);
  console.error('❌ message   :', err?.message);
  console.error('❌ code      :', err?.code);
  console.error('❌ http_code :', err?.http_code);
  console.error('❌ statusCode:', err?.statusCode);
  console.error('❌ stack     :');
  console.error(err?.stack);

  if (err?.errors && typeof err.errors === 'object') {
    console.error('❌ validation errors:');
    Object.keys(err.errors).forEach((k) => {
      console.error(`   ${k}:`, err.errors[k]?.message);
    });
  }
  console.error('═════════════════════════════════════════\n');

  if (res.headersSent) return next(err);

  let status = 500;
  if (typeof err?.statusCode === 'number') status = err.statusCode;
  else if (typeof err?.http_code === 'number') status = err.http_code;
  else if (err?.name === 'MulterError') status = 400;
  else if (err?.code === 'LIMIT_FILE_SIZE') status = 413;

  let message = 'Internal server error';
  if (typeof err?.message === 'string' && err.message.trim()) {
    message = err.message;
  } else if (typeof err === 'string') {
    message = err;
  } else if (err?.name === 'MulterError') {
    message = `Upload error: ${err.code || 'unknown'}`;
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && {
      errorName: err?.name,
      errorCode: err?.code,
      errorStack: err?.stack?.split('\n').slice(0, 5),
    }),
  });
});

// ==========================================================
// 🔌 SOCKET.IO
// ==========================================================
const io = new Server(server, {
  transports: ["polling", "websocket"],
  cors: corsOptions,
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7,
});

app.set("io", io);
app.set("socketio", io);
global.io = io;

console.log('✅ Socket.IO instance stored in app as "io" and "socketio"');

const onlineUsers = new Map();
const userSockets = new Map();

io.on("connection", (socket) => {
  console.log(`🔗 A user connected: ${socket.id}`);

  socket.on("join", (payload) => {
    if (typeof payload === 'string' || typeof payload === 'number') {
      socket.join(payload.toString());
      console.log(`👤 User joined personal room: ${payload}`);
    } else if (payload && typeof payload === 'object') {
      if (payload.userId) {
        socket.join(payload.userId.toString());
        console.log(`👤 User joined personal room: ${payload.userId}`);
      }
      if (payload.groupIds && Array.isArray(payload.groupIds)) {
        payload.groupIds.forEach(groupId => {
          socket.join(`group_${groupId}`);
          console.log(`👥 User joined group room: group_${groupId}`);
        });
      }
    }
  });

  socket.on("joinGroup", (groupId) => {
    if (groupId) {
      socket.join(`group_${groupId}`);
      console.log(`👥 User dynamically joined group room: group_${groupId}`);
    }
  });

  socket.on("leaveGroup", (groupId) => {
    if (groupId) {
      socket.leave(`group_${groupId}`);
      console.log(`🚪 User dynamically left group room: group_${groupId}`);
    }
  });

  socket.on("leave", (userId) => {
    if (userId) {
      socket.leave(userId.toString());
      console.log(`🚪 User left their personal room (Logged Out): ${userId}`);
    }
  });

  socket.on("updateCart", () => {
    io.emit("cartUpdated");
  });

  socket.on("joinUserRoom", (userId) => {
    if (userId) {
      const uid = String(userId);
      socket.join(`user_${uid}`);
      socket.join(uid);
      socket.userId = uid;
      userSockets.set(socket.id, uid);

      if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
      onlineUsers.get(uid).add(socket.id);

      socket.broadcast.emit("userOnline", { userId: uid });
      socket.emit("onlineUsers", Array.from(onlineUsers.keys()));
      console.log(`👤 User joined personal room: user_${uid} (sockets: ${onlineUsers.get(uid).size})`);
    }
  });

  socket.on("leaveUserRoom", (userId) => {
    if (userId) {
      const uid = String(userId);
      socket.leave(`user_${uid}`);
      socket.leave(uid);

      if (onlineUsers.has(uid)) {
        onlineUsers.get(uid).delete(socket.id);
        if (onlineUsers.get(uid).size === 0) {
          onlineUsers.delete(uid);
          socket.broadcast.emit("userOffline", { userId: uid });
        }
      }
      userSockets.delete(socket.id);
      console.log(`🚪 User left personal room: user_${uid}`);
    }
  });

  socket.on("joinConversation", (conversationId) => {
    if (conversationId) {
      socket.join(`conversation_${conversationId}`);
      console.log(`💬 User joined conversation room: conversation_${conversationId}`);
    }
  });

  socket.on("leaveConversation", (conversationId) => {
    if (conversationId) {
      socket.leave(`conversation_${conversationId}`);
      console.log(`🚪 User left conversation room: conversation_${conversationId}`);
    }
  });

  socket.on("typing", (data) => {
    const { conversationId, userId, userName, receiverId } = data;
    if (conversationId && userId) {
      socket.to(`conversation_${conversationId}`).emit("userTyping", {
        conversationId,
        userId,
        userName,
        timestamp: new Date(),
      });
      if (receiverId) {
        socket.to(`user_${receiverId}`).emit("userTyping", {
          conversationId,
          userId,
          userName,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on("stopTyping", (data) => {
    const { conversationId, userId, receiverId } = data;
    if (conversationId && userId) {
      socket.to(`conversation_${conversationId}`).emit("userStoppedTyping", {
        conversationId,
        userId,
        timestamp: new Date(),
      });
      if (receiverId) {
        socket.to(`user_${receiverId}`).emit("userStoppedTyping", {
          conversationId,
          userId,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on("messageRead", (data) => {
    const { conversationId, messageId, userId, senderId } = data;
    if (conversationId && messageId) {
      const payload = {
        conversationId,
        messageId,
        readBy: userId,
        readAt: new Date(),
      };
      socket.to(`conversation_${conversationId}`).emit("messageReadReceipt", payload);
      if (senderId) {
        socket.to(`user_${senderId}`).emit("messageReadReceipt", payload);
      }
    }
  });

  socket.on("messagesRead", (data) => {
    const { conversationId, messageIds, userId, senderId } = data;
    if (conversationId && messageIds && messageIds.length > 0) {
      const payload = {
        conversationId,
        messageIds,
        readBy: userId,
        readAt: new Date(),
      };
      socket.to(`conversation_${conversationId}`).emit("messagesReadReceipt", payload);
      if (senderId) {
        socket.to(`user_${senderId}`).emit("messagesReadReceipt", payload);
      }
    }
  });

  socket.on("postViewed", (data) => {
    const { postId, userId, postOwnerId } = data;
    if (postId) {
      socket.broadcast.emit("postViewCount", {
        postId,
        userId,
        timestamp: new Date(),
      });
      if (postOwnerId && String(postOwnerId) !== String(userId)) {
        socket.to(`user_${postOwnerId}`).emit("postViewedNotification", {
          postId,
          viewedBy: userId,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on("newComment", (data) => {
    const { postId, comment, postOwnerId, commenterId, commenterName } = data;
    if (postId) {
      io.emit("commentAdded", {
        postId,
        comment,
        commenterId,
        commenterName,
        timestamp: new Date(),
      });
      if (postOwnerId && String(postOwnerId) !== String(commenterId)) {
        socket.to(`user_${postOwnerId}`).emit("commentNotification", {
          postId,
          comment,
          commenterId,
          commenterName,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on("newLike", (data) => {
    const { postId, likedBy, likedByName, postOwnerId } = data;
    if (postId) {
      io.emit("likeAdded", {
        postId,
        likedBy,
        likedByName,
        timestamp: new Date(),
      });
      if (postOwnerId && String(postOwnerId) !== String(likedBy)) {
        socket.to(`user_${postOwnerId}`).emit("likeNotification", {
          postId,
          likedBy,
          likedByName,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on("unlike", (data) => {
    const { postId, unlikedBy } = data;
    if (postId) {
      io.emit("likeRemoved", {
        postId,
        unlikedBy,
        timestamp: new Date(),
      });
    }
  });

  socket.on("storyViewed", (data) => {
    const { storyId, userId, userName, storyOwnerId } = data;
    if (storyOwnerId && String(storyOwnerId) !== String(userId)) {
      socket.to(`user_${storyOwnerId}`).emit("storyViewNotification", {
        storyId,
        viewedBy: userId,
        viewedByName: userName,
        timestamp: new Date(),
      });
    }
  });

  socket.on("storyReaction", (data) => {
    const { storyId, userId, userName, emoji, storyOwnerId } = data;
    if (storyOwnerId && String(storyOwnerId) !== String(userId)) {
      socket.to(`user_${storyOwnerId}`).emit("storyReactionNotification", {
        storyId,
        reactedBy: userId,
        reactedByName: userName,
        emoji,
        timestamp: new Date(),
      });
    }
  });

  socket.on("newFollow", (data) => {
    const { followedBy, followedByName, followedByAvatar, followedUserId } = data;
    if (followedUserId) {
      socket.to(`user_${followedUserId}`).emit("followNotification", {
        followedBy,
        followedByName,
        followedByAvatar,
        timestamp: new Date(),
      });
    }
  });

  socket.on("unfollow", (data) => {
    const { unfollowedBy, unfollowedUserId } = data;
    if (unfollowedUserId) {
      socket.to(`user_${unfollowedUserId}`).emit("unfollowNotification", {
        unfollowedBy,
        timestamp: new Date(),
      });
    }
  });

  socket.on("sendNotification", (data) => {
    const { recipientId, notification } = data;
    if (recipientId) {
      io.to(`user_${recipientId}`).emit("newNotification", notification);
    }
  });

  socket.on("markNotificationRead", (data) => {
    const { userId, notificationId } = data;
    if (userId) {
      io.to(`user_${userId}`).emit("notificationRead", {
        notificationId,
        timestamp: new Date(),
      });
    }
  });

  socket.on("setOnline", (userId) => {
    if (userId) {
      const uid = String(userId);
      socket.userId = uid;
      userSockets.set(socket.id, uid);

      if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
      onlineUsers.get(uid).add(socket.id);

      socket.broadcast.emit("userOnline", { userId: uid });
      socket.emit("onlineUsers", Array.from(onlineUsers.keys()));
      console.log(`🟢 User ${uid} is online`);
    }
  });

  socket.on("setOffline", (userId) => {
    if (userId) {
      const uid = String(userId);
      if (onlineUsers.has(uid)) {
        onlineUsers.get(uid).delete(socket.id);
        if (onlineUsers.get(uid).size === 0) {
          onlineUsers.delete(uid);
          socket.broadcast.emit("userOffline", { userId: uid });
        }
      }
      console.log(`🔴 User ${uid} is offline`);
    }
  });

  socket.on("checkOnline", (userIds, callback) => {
    if (Array.isArray(userIds)) {
      const status = {};
      userIds.forEach((uid) => {
        status[uid] = onlineUsers.has(String(uid));
      });
      if (typeof callback === "function") callback(status);
      else socket.emit("onlineStatus", status);
    }
  });

  socket.on("commentTyping", (data) => {
    const { postId, userId, userName } = data;
    if (postId) {
      socket.to(`post_${postId}`).emit("userCommentTyping", {
        postId,
        userId,
        userName,
      });
    }
  });

  socket.on("joinPostRoom", (postId) => {
    if (postId) {
      socket.join(`post_${postId}`);
      console.log(`📝 User joined post room: post_${postId}`);
    }
  });

  socket.on("leavePostRoom", (postId) => {
    if (postId) {
      socket.leave(`post_${postId}`);
      console.log(`🚪 User left post room: post_${postId}`);
    }
  });

  socket.on("startViewing", (data) => {
    const { postId } = data;
    if (postId) {
      socket.join(`viewing_${postId}`);
      socket.currentViewing = postId;
      const room = io.sockets.adapter.rooms.get(`viewing_${postId}`);
      const viewersCount = room ? room.size : 1;
      io.to(`viewing_${postId}`).emit("liveViewersUpdate", {
        postId,
        viewersCount,
      });
    }
  });

  socket.on("stopViewing", (data) => {
    const { postId } = data;
    if (postId) {
      socket.leave(`viewing_${postId}`);
      const room = io.sockets.adapter.rooms.get(`viewing_${postId}`);
      const viewersCount = room ? room.size : 0;
      io.to(`viewing_${postId}`).emit("liveViewersUpdate", {
        postId,
        viewersCount,
      });
    }
  });

  socket.on("disconnect", () => {
    const userId = userSockets.get(socket.id);
    if (userId) {
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) {
          onlineUsers.delete(userId);
          socket.broadcast.emit("userOffline", { userId });
          console.log(`🔴 User ${userId} went offline (disconnected)`);
        }
      }
      userSockets.delete(socket.id);
    }
    if (socket.currentViewing) {
      const room = io.sockets.adapter.rooms.get(`viewing_${socket.currentViewing}`);
      const viewersCount = room ? room.size : 0;
      io.to(`viewing_${socket.currentViewing}`).emit("liveViewersUpdate", {
        postId: socket.currentViewing,
        viewersCount,
      });
    }
    console.log("❌ User disconnected:", socket.id);
  });
});

// ==========================================================
// 🚀 START SERVER
// ==========================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO is ready with io instance`);
  console.log(`📡 io instance available at: app.get('io')`);
  console.log(`📊 Online users tracking enabled`);
  console.log(`💬 Real-time chat & notifications enabled`);
});