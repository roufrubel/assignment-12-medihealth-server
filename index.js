const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;


// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://assignment-12-medihealth.web.app",
      "https://assignment-12-medihealth.firebaseapp.com",
    ],
  })
);

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tjqypvp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("mediHealth").collection("users");
    const medicineCollection = client.db("mediHealth").collection("medicine");
    const cartCollection = client.db("mediHealth").collection("carts");
    const paymentCollection = client.db("mediHealth").collection("payments");
    const advertisementCollection = client.db("mediHealth").collection("advertisement");

    // ---------------- middlewares -------------------
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };


    // -------------- use verify admin after verifyToken ---------------------
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };


    // -------------------- medicine related api -----------------------------
    app.get("/medicine", async (req, res) => {
      const result = await medicineCollection.find().toArray();
      res.send(result);
    });


    app.get("/medicine/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      // const query = {_id: id};
      const result = await medicineCollection.findOne(query);
      res.send(result);
    });


    app.post("/medicine", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await medicineCollection.insertOne(item);
      res.send(result);
    });


    app.patch("/medicine/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          category: item.category,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          dosage: item.dosage,
          image: item.image,
          short_description: item.short_description,
        },
      };

      const result = await medicineCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });


    app.delete("/medicine/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      // const query = {_id: new ObjectId(id)};
      const query = { _id: new ObjectId(id) };
      const result = await medicineCollection.deleteOne(query);
      res.send(result);
    });


    // ------------------ cart related api ------------------------

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // app.post("/carts", async (req, res) => {
    //   const cartItem = req.body;
    //   const result = await cartCollection.insertOne(cartItem);
    //   res.send(result);
    // });

    // increase quantity
    app.patch("/carts/increase/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const filter = { _id: new ObjectId(id) };
        const update = { $inc: { quantity: 1 } }; // increment quantity by 1

        const result = await cartCollection.updateOne(filter, update);

        if (result.modifiedCount > 0) {
          res.send({ message: "Quantity increased successfully" });
        } else {
          res.send({ message: "Failed to increase quantity" });
        }
      } catch (error) {
        console.error("Error increasing quantity:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // Decrease quantity
    app.patch("/carts/decrease/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const filter = { _id: new ObjectId(id) };

        // find the cart item to check its current quantity
        const cartItem = await cartCollection.findOne(filter);

        if (!cartItem) {
          return res.status(404).send({ message: "Cart item not found" });
        }

        if (cartItem.quantity > 1) {
          // Decrease the quantity by 1
          const update = { $inc: { quantity: -1 } };

          const result = await cartCollection.updateOne(filter, update);

          if (result.modifiedCount > 0) {
            res.send({ message: "Quantity decreased successfully" });
          } else {
            res.send({ message: "Failed to decrease quantity" });
          }
        } else {
          // if quantity is 1, delete the item from the cart
          const deleteResult = await cartCollection.deleteOne(filter);

          if(deleteResult.deletedCount > 0){
            res.send({ message: "Item removed from cart" });
          } else {
            res.send({ message: "Failed to remove item from cart" });
          }

        }

      } catch (error) {
        console.error("Error decreasing quantity:", error);
        res.status(500).send({ message: "Internal server error"});
      }
    });


    app.post("/carts", async (req, res) => {
      const { medicineId, buyerEmail, name, image, price, category, sellerEmail } = req.body;

      // Check if item already exists in cart for the user
      const existingCartItem = await cartCollection.findOne({
        medicineId,
        buyerEmail
      });

      if (existingCartItem) {
        // If item exists, increase the quantity
        const filter = { _id: existingCartItem._id };
        const update = { $inc: { quantity: 1 } }; // increase quantity by 1
        const result = await cartCollection.updateOne(filter, update);
        res.send(result);
      } else {
        // If item does not exist, add it to the cart with quantity 1
        const cartItem = {
          medicineId,
          buyerEmail,
          name,
          image,
          price,
          category,
          sellerEmail,
          quantity: 1,
        };
        const result = await cartCollection.insertOne(cartItem);
        res.send(result);
      }
    });

    // --------------------- jwt related api --------------------------
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1hr",
      });
      res.send({ token });
    });

    // ------------------- users related api ----------------------------
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );


    app.patch(
      "/users/seller/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "seller",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );


    app.patch(
      "/users/user/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "user",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );


    // app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await userCollection.deleteOne(query);
    //   res.send(result);
    // });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      // app.get("/users/admin/:email",  async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.get("/users/seller/:email", verifyToken, async (req, res) => {
      // app.get("/users/seller/:email",  async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let seller = false;
      if (user) {
        seller = user?.role === "seller";
      }
      res.send({ seller });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // insert email if user doesn't exists
      // the ways: 1. unique email 2. upsert 3. simple checking
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists!", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // --------------------- payment intent --------------------------------
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside payment intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });


    app.patch('/payments/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const update = { 
        $set: { status: status }
       }
    
      try {
        const result = await paymentCollection.updateOne(query, update);
    
        if (result.modifiedCount > 0) {
          res.status(200).send({ modifiedCount: result.modifiedCount });
        } else {
          res.status(404).send('Payment not found');
        }
      } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).send('Internal server error');
      }
    });

    // TODO: need to add verifySeller
    app.get("/payments", verifyToken,  async (req, res) => {
    // app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      // carefully delete each item from the cart
      console.log("payment info", payment);
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };

      const deleteResult = await cartCollection.deleteMany(query);
      res.send({ paymentResult, deleteResult });
    });



    // -------------- advertisement api -----------------------------

    
   // Function to handle the PATCH request for updating advertisement status
app.patch("/advertisement/:id", async (req, res) => {
  const { id } = req.params; // Get the ID from the route params
  const { status } = req.body; // Get the new status from the request body

  try {
    // Ensure the provided status is valid
    if (!["used", "not used"].includes(status)) {
      return res.status(400).send({ error: "Invalid status value" });
    }

    // Update the advertisement document in MongoDB by its _id
    const result = await advertisementCollection.updateOne(
      { _id: new ObjectId(id) }, // Find the advertisement by its _id
      { $set: { status } } // Update the status field
    );

    // Send the result back to the client
    if (result.modifiedCount > 0) {
      res.send({ success: true, modifiedCount: result.modifiedCount });
    } else {
      res.status(404).send({ success: false, message: "Advertisement not found or status unchanged" });
    }
  } catch (error) {
    // Handle errors (e.g., invalid ID format)
    res.status(500).send({ error: "Internal server error" });
  }
});


    
    app.get("/advertisement", async (req, res) => {
      const result = await advertisementCollection.find().toArray();
      res.send(result);
    });  


    app.post("/advertisement",  async (req, res) => {
      const item = req.body;
      const result = await advertisementCollection.insertOne(item);
      res.send(result);
    });




    // ----------------  stats or analytics --------------------------------
app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {

  const result = await paymentCollection.aggregate([
    {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: '$price'
        }
      }
    }
  ]).toArray();

  const revenue = result.length > 0 ? result[0].totalRevenue : 0;

  res.send({
     revenue
  })
})

// ------------------- using aggregate pipeline----------------
app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
  const result = await paymentCollection.aggregate([
    {
      $unwind: '$medicineItemIds'
    },
    {
      $lookup: {
        from: 'medicine',
        localField: 'medicineItemIds',
        foreignField: '_id',
        as: 'medicineItems'
      }
    },
    {
      $unwind: '$medicineItems'
    },
    {
      $group: {
        _id: '$medicineItems.category',
        quantity: { $sum: 1 },
        revenue: { $sum: '$medicineItems.price' },

      }
    },
    {
      $project: {
        _id: 0,
        category: '$_id',
        quantity: '$quantity',
        revenue: '$revenue'
      }     

    }

  ]).toArray();

  res.send(result);
})

    
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("mediHealth running");
});

app.listen(port, () => {
  console.log(`mediHealth is running on port ${port}`);
});
