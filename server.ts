import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getUsersCollection, getItemsCollection, getMatchesCollection } from './src/db.js';
import type { UserProfile as User, ItemPost as Item, MatchResult as Match } from './src/types.js';





async function startServer() {
  await initDb();
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // User Routes
  app.get('/api/users/:uid', async (req, res) => {
    try {
      const usersColl = await getUsersCollection();
      const user = await usersColl.findOne({ uid: req.params.uid });
      if (user) res.json(user);
      else res.status(404).json({ error: 'User not found' });
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.patch('/api/users/:uid', async (req, res) => {
    try {
      const usersColl = await getUsersCollection();
      const result = await usersColl.findOneAndUpdate(
        { uid: req.params.uid },
        { $set: req.body },
        { returnDocument: 'after' }
      );
      const updatedUser = (result as any).value;
      if (updatedUser) {
        res.json(updatedUser);
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const usersColl = await getUsersCollection();
      const { uid } = req.body;
      const existingUser = await usersColl.findOne({ uid });
      if (existingUser) {
        // Upsert - merge, don't overwrite password if not provided
        const updateFields = { ...req.body };
        if (!updateFields.password && existingUser.password) {
          updateFields.password = existingUser.password;
        }
        const result = await usersColl.findOneAndUpdate(
          { uid },
          { $set: updateFields },
          { upsert: true, returnDocument: 'after' }
        );
        res.json((result as any).value!);
      } else {
        await usersColl.insertOne({ ...req.body, uid });
        res.json(req.body);
      }
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const usersColl = await getUsersCollection();
      const user = await usersColl.findOne({ email });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (user.password && user.password !== password) {
        return res.status(401).json({ error: 'Invalid password' });
      }
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/users', async (req, res) => {
    try {
      const usersColl = await getUsersCollection();
      const users = await usersColl.find({}).toArray();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Item Routes
  app.get('/api/items', async (req, res) => {
    try {
      const itemsColl = await getItemsCollection();
      const now = new Date();
      const items = await itemsColl.find({
        $or: [
          { status: { $ne: 'resolved' } },
          {
            status: 'resolved',
            resolvedAt: { 
              $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() 
            }
          }
        ]
      }).toArray();
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/items/:id', async (req, res) => {
    try {
      const itemsColl = await getItemsCollection();
      const item = await itemsColl.findOne({ id: req.params.id });
      if (item) res.json(item);
      else res.status(404).json({ error: 'Item not found' });
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/items', async (req, res) => {
    try {
      const newItem = {
        ...req.body,
        id: Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString()
      };
      const itemsColl = await getItemsCollection();
      await itemsColl.insertOne(newItem);
      res.json(newItem);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.patch('/api/items/:id', async (req, res) => {
    try {
      const itemsColl = await getItemsCollection();
      const currentItem = await itemsColl.findOne({ id: req.params.id });
      if (!currentItem) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const updates = { ...req.body };
      if (updates.status === 'resolved' && currentItem.status !== 'resolved') {
        updates.resolvedAt = new Date().toISOString();
      }
      const result = await itemsColl.findOneAndUpdate(
        { id: req.params.id },
        { $set: updates },
        { returnDocument: 'after' }
      );
      res.json((result as any).value!);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.delete('/api/items/:id', async (req, res) => {
    try {
      const itemsColl = await getItemsCollection();
      const result = await itemsColl.deleteOne({ id: req.params.id });
      if (result.deletedCount > 0) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Item not found' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Match Routes
  app.get('/api/matches', async (req, res) => {
    try {
      const matchesColl = await getMatchesCollection();
      const matches = await matchesColl.find({}).toArray();
      res.json(matches);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/matches', async (req, res) => {
    try {
      const matchesColl = await getMatchesCollection();
      const { lostItemId, foundItemId } = req.body;
      
      // Check if match already exists
      const existingMatch = await matchesColl.findOne({ 
        lostItemId, 
        foundItemId 
      });
      
      if (existingMatch) {
        return res.json(existingMatch);
      }

      const newMatch = {
        ...req.body,
        id: Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString()
      };
      await matchesColl.insertOne(newMatch);
      res.json(newMatch);
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/change-password', async (req, res) => {
    try {
      const { uid, oldPassword, newPassword } = req.body;
      const usersColl = await getUsersCollection();
      const user = await usersColl.findOne({ uid });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (user.password && user.password !== oldPassword) {
        return res.status(401).json({ error: 'Incorrect current password' });
      }
      
      await usersColl.updateOne({ uid }, { $set: { password: newPassword } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  });
}

startServer();
