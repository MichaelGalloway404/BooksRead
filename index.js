import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'your username',
  password: 'your password',
  database: 'booktracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export default pool;


const app = express();
const port = 3000;


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

let items = [];

// Gobals

// varible to keep track of what page we are on
let pageQuantity = 0;
let currentUser;


// Utils

function addBook(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
}

// Fetch ISBNs and book data from title/author
async function getIsbnFromName(title, author) {
  const covers = [];

  const params = new URLSearchParams();
  if (title) params.append("title", title);
  if (author) params.append("author", author);

  try {
    const response = await axios.get(`https://openlibrary.org/search.json?${params.toString()}`);
    const docs = response.data.docs || [];

    for (const doc of docs) {
      if (doc.cover_i) {
        covers.push({
          title: doc.title,
          author: (doc.author_name || []).join(", "),
          coverUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
          olid: doc.key,
          isbn: doc.isbn && doc.isbn.length > 0 ? doc.isbn[0] : null,
        });
      }
    }

  } catch (error) {
    console.error("Search API error:", error.message);
  }

  return covers;
}

// Create books array with cover URLs for current page slice
function getImagesForPage(covers, start, end) {
  const sliced = covers.slice(start, end);

  // Map to books format for template
  return sliced.map((book, index) => ({
    title: book.title || `Book with ISBN ${book.isbn || "unknown"}`,
    author: book.author || "Unknown Author",
    coverUrl: book.coverUrl || addBook(book.isbn || ""),
    olid: book.olid,
    isbn: book.isbn,
  }));
}

// Routes

// LOGIN
app.get("/login",(req,res)=>{
    currentUser = null;
    res.render("login.ejs");
});

app.post("/login", async (req, res) => {
  const { Username, Password } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [Username, Password]
    );

    if (rows.length === 0) {
      // Login failed
      return res.render("login.ejs", { error: "Invalid credentials" });
    }

    const user = rows[0];
    currentUser = user.id;

    // Optionally, fetch books for the user
    const [books] = await pool.query(
      "SELECT title, author, cover_url FROM books WHERE user_id = ?",
      [user.id]
    );

    let userName = String(user.username).charAt(0).toUpperCase() + String(user.username).slice(1);
    res.render("profile.ejs", {
      listTitle: userName + "'s Books",
      listItems: books,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


// SIGN-UP
app.get("/signUp",(req,res)=>{
  currentUser = null;
  res.render("signUp.ejs");
});
app.post("/signUp", async (req, res) => {
  const { Username, Password, confirmPassword } = req.body;

  if (!Username || !Password || Password !== confirmPassword) {
    return res.render("signUp.ejs", { error: "Invalid input" });
  }

  try {
    // Check if username already exists
    const [existingUsers] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [Username]
    );

    if (existingUsers.length > 0) {
      return res.render("signUp.ejs", { error: "Username already taken" });
    }

    // Insert new user
    await pool.query(
      "INSERT INTO users (username, password) VALUES (?, ?)",
      [Username, Password] // No encryption
    );

    // Redirect or render login page
    res.render("login.ejs", { message: "Account created, please log in" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).send("Server error");
  }
});


// home page
app.get("/", async (req, res) => {
  let [rows] = await pool.query("SELECT username FROM users");
  for(let i=0;i<rows.length;i++){
    rows[i]['username'] = rows[i]['username'].toUpperCase();
  }
  pageQuantity = 0;   // reset page
  currentUser = null; // reset user
  res.render("index.ejs",{rows:rows});
});


app.post("/profileView", async (req, res) => {
  
      const [rows] = await pool.query(
        "SELECT id FROM users WHERE username = ?",
        req.body.user
      );

      if (rows.length === 0) {
          // no user
          res.render("profile.ejs", {
          listTitle: "No Books",
          listItems: items,
        });
      }

      const user = rows[0];

      // Optionally, fetch books for the user
      const [books] = await pool.query(
        "SELECT title, author, cover_url FROM books WHERE user_id = ?",
        [user.id]
      );
      pageQuantity = 0; // reset page
      let userName = String(user.username).charAt(0).toUpperCase() + String(user.username).slice(1);
      res.render("profileView.ejs", {
        listTitle: req.body.user + "'s Books",
        listItems: books,
      });
  
});

// home page
app.get("/profile", async (req, res) => {
  if(currentUser){
      const [rows] = await pool.query(
        "SELECT * FROM users WHERE id = ?",
        currentUser
      );

      if (rows.length === 0) {
          // no user
          res.render("profile.ejs", {
          listTitle: "No Books",
          listItems: items,
        });
      }

      const user = rows[0];

      // Optionally, fetch books for the user
      const [books] = await pool.query(
        "SELECT title, author, cover_url FROM books WHERE user_id = ?",
        [user.id]
      );
      pageQuantity = 0; // reset page
      let userName = String(user.username).charAt(0).toUpperCase() + String(user.username).slice(1);
      res.render("profile.ejs", {
        listTitle: userName + "'s Books",
        listItems: books,
      });
  }else{
    res.redirect("/");
  }
});

// search for a book with paging
app.post("/search", async (req, res) => {
  try {
    const { bookTitle, bookAuthor } = req.body;

    const isDirectIsbn = /^\d{10,13}$/.test(bookTitle.trim());
    let covers = [];

    if (isDirectIsbn) {
      // Direct ISBN search
      covers = [{
        title: `Book with ISBN ${bookTitle.trim()}`,
        author: "Unknown Author",
        coverUrl: addBook(bookTitle.trim()),
        isbn: bookTitle.trim(),
      }];
    } else {
      covers = await getIsbnFromName(bookTitle, bookAuthor);
    }

    const index = parseInt(req.body.index, 10);
    pageQuantity += index || 0; 
    const books = getImagesForPage(covers, pageQuantity, pageQuantity + 20);

    // Save covers in session or global (if needed, here just pass to render)
    res.render("bookSelection", { books, pageQuantity, bookTitle, bookAuthor});
  } catch (err) {
    console.error("Error in POST /search:", err);
    res.redirect("/");
  }
});


app.post("/addBook", async (req, res) => {
  const userId = currentUser; 

  const { title, author, coverUrl } = req.body;

  if (!userId) {
    return res.status(401).send("Not logged in");
  }

  if (!title || !author || !coverUrl) {
    return res.status(400).send("Missing book info");
  } 

  try {
    await pool.query(
      "INSERT INTO books (user_id, title, author, cover_url) VALUES (?, ?, ?, ?)",
      [userId, title, author, coverUrl]
    );

    res.redirect("/profile"); // or wherever your book list is shown
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.log("Duplicate book for user");
    } else {
      console.error("Error adding book:", err);
    }
    res.redirect("/profile");
  }
});

app.post("/deleteBook", async (req, res) => {
  const userId = currentUser; 
  const { title, author } = req.body;

  if (!userId) {
    return res.status(401).send("Not logged in");
  }

  try {
    await pool.query(
      "DELETE FROM books WHERE user_id = ? AND title = ? AND author = ?",
      [userId, title, author]
    );

    res.redirect("/profile");
  } catch (err) {
    console.error("Error deleting book:", err);
    res.status(500).send("Server error");
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});