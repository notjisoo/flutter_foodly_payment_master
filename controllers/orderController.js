async function findOrder(client, orderId) {
  const database = client.db("yourDatabaseName"); // 替换为你的数据库名称
  const orders = database.collection("orders"); // 替换为你的集合名称

  try {
    const order = await orders.findOne({ _id: orderId });
    if (order) {
      console.log("Order found:", order);
      return order;
    } else {
      console.log("Order not found");
      return null;
    }
  } catch (error) {
    console.error("Error finding order:", error);
  }
}

async function updateOrder(client, orderId, updateData) {
  const database = client.db("yourDatabaseName");
  const orders = database.collection("orders");

  try {
    const result = await orders.updateOne(
      { _id: orderId },
      { $set: updateData }
    );
    if (result.matchedCount > 0) {
      console.log("Order updated");
    } else {
      console.log("Order not found for update");
    }
  } catch (error) {
    console.error("Error updating order:", error);
  }
}

export { findOrder, updateOrder };
