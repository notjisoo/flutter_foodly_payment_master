const express = require("express");
const app = express();
const dotenv = require("dotenv");
dotenv.config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ObjectId } = require("mongodb");

// Utility function to check if a string is a valid ObjectId
function isValidObjectId(id) {
  return ObjectId.isValid(id) && new ObjectId(id).toString() === id;
}
const cors = require("cors");

// 连接数据库
let client;
let database;

async function connectToDatabase() {
  if (!client) {
    const uri = process.env.MONGODB_URI; // 替换为你的 MongoDB URI
    client = new MongoClient(uri);
    await client.connect();
    console.log("Connected to MongoDB");
    database = client.db("test"); // 替换为你的数据库名称
  }
  return database;
}

app.use(
  cors({
    origin: "*", // 或者指定允许的域名
  })
);

// 排除webhook路由使用原始body
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/webhook")) {
    express.json()(req, res, next);
  } else {
    next();
  }
});

// 创建支付意图的 API
app.post("/api/process-payment", async (req, res) => {
  try {
    // 接收来自前端的支付数据
    const { amount = 500, currency = "usd", paymentMethodId } = req.body;

    if (!amount || !currency || !paymentMethodId) {
      return res.status(400).json({ error: "Invalid parameters." });
    }

    // 创建支付意图
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethodId, // 前端传递的
      payment_method_types: ["card"],
      type: "virtual",
      // confirm: true, // 直接确认支付（无需前端再次调用）
      // cardholder: "ich_1MsKAB2eZvKYlo2C3eZ2BdvK",
    });

    // 返回 client_secret
    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error processing payment:", error);
    res
      .status(500)
      .json({ error: "Payment processing failed", details: error.message });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    // 1.创建客户 - 可选
    if (
      !req.body.cartItems ||
      !Array.isArray(req.body.cartItems) ||
      req.body.cartItems.length === 0
    ) {
      return res.status(400).json({ error: "Invalid or empty cartItems" });
    }

    const customer = await stripe.customers
      .create({
        metadata: {
          userId: req.body.userId,
          cart: JSON.stringify(req.body.cartItems),
        },
      })
      .catch((error) => {
        console.error("Error creating customer:", error);
        throw new Error("Failed to create customer");
      });

    // 2.格式化商品行项目
    const line_items = req.body.cartItems.map((item) => {
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            description: item.description,
            metadata: {
              id: item.id,
            },
            images: [item.imageUrl],
          },
          unit_amount: Math.round(item.price * 100), // 转换为美分
        },
        quantity: item.quantity,
      };
    });

    // 3.创建checkout session
    console.log(customer.id);
    console.log("customer.metadata.cart", customer.metadata.cart);

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      line_items,
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    // 4.返回session URL给客户端
    res.send({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.message,
    });
  }
});

app.get("/api/test", (req, res) => {
  res.send("Hello World");
});

// 设置 Webhook 监听端点
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      // 添加webhook接收日志
      console.log("收到Webhook事件:", event.type);
      console.log("Webhook事件数据:", event.data);

      switch (event.type) {
        // 支付意图成功
        case "payment_intent.succeeded":
          try {
            const paymentIntent = event.data.object;
            const db = await connectToDatabase();
            const payments = db.collection("payments");
            console.log("创建支付记录");
            // 创建支付记录
            const payment = {
              paymentIntentId: paymentIntent.id,
              customerId: paymentIntent.customer,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: "succeeded",
              metadata: paymentIntent.metadata,
              items: JSON.parse(paymentIntent.metadata.items || "[]"), // 如果在metadata中存储了商品信息
            };

            // 保存到数据库
            const result = await payments.insertOne(payment);
            console.log("支付记录已保存:", result.insertedId);
          } catch (error) {
            console.error("保存支付记录失败:", error);
          }
          break;

        // 支付意图失败
        case "payment_intent.payment_failed":
          try {
            const paymentIntent = event.data.object;

            console.log("失败的支付记录已保存:", payment);
          } catch (error) {
            console.error("保存失败支付记录错误:", error);
          }
          break;

        // 结账会话已完成
        case "checkout.session.completed":
          try {
            const checkoutData = event.data.object;
            console.log("收到支付完成事件，session数据:", checkoutData);

            // 确保 checkoutData.customer 存在
            if (!checkoutData.customer) {
              console.error("Missing customer data in checkout session.");
              break;
            }

            // 使用 await 进行 Stripe 客户信息的获取
            const customer = await stripe.customers.retrieve(
              checkoutData.customer
            );
            console.log("获取到客户信息:", customer);

            // 确保 cart 数据存在
            const cart = customer.metadata?.cart;
            if (!cart) {
              console.error("Cart is missing in customer metadata.");
              break;
            }

            const data = JSON.parse(cart);
            console.log("解析的购物车数据:", data);

            const products = data.map((item) => ({
              name: item.name,
              id: item.id,
              price: item.price,
              quantity: item.quantity,
              restaurantId: item.restaurantId,
              orderId: item.orderId,
            }));
            console.log("处理后的商品数据:", products);

            // 获取数据库连接
            const db = await connectToDatabase();
            const ordersCollection = db.collection("orders");

            // Validate orderId before using ObjectId
            if (!isValidObjectId(products[0].orderId)) {
              console.error("Invalid orderId:", products[0].orderId);
              return res.status(400).json({ error: "Invalid orderId format." });
            }

            // 更新订单状态
            const updatedOrder = await ordersCollection.findOneAndUpdate(
              { _id: new ObjectId(products[0].orderId) },
              {
                $set: {
                  paymentStatus: "Completed",
                  orderStatus: "Placed",
                },
              },
              { returnDocument: "after" }
            );
            console.log("更新后的订单数据:", updatedOrder.value);

            // 通知主后端服务器
            try {
              const response = await fetch(
                `${process.env.MAIN_BACKEND_URL}/api/orders/payment-success`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    orderId: products[0].orderId,
                    orderDetails: products,
                    paymentDetails: {
                      sessionId: checkoutData.id,
                      customerId: checkoutData.customer,
                      amount: checkoutData.amount_total,
                      currency: checkoutData.currency,
                    },
                  }),
                }
              );

              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }

              console.log("已成功通知主后端服务器");
            } catch (error) {
              console.error("通知主后端服务器失败:", error);
            }

            console.log("订单更新和通知发送成功");
          } catch (error) {
            console.error("处理结账会话时出错:", error);
          }
          break;

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.status(200).send("Webhook received");
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

module.exports = app;
