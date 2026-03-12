NetBots is a multiplayer robot programming game in its style similar to Robocode. Programming can be done through integrated code editor by writing JavaScript or any other popular programming language that compiles to WebAssembly. Players can test their scripted robots against each other in different types of maps with customized game rules in real time.

The battles can be observed in real time, but they are essentially simulated in advance, as the outcome depends completely on the script code, not on player's actions. There could be various game modes, such as 1v1, 2v2, 4v4, 3v3v3 and so on.

User writes scripts using the preferred programming language, and uses game api methods such as move, rotate, shoot, turn and so on. In addition, a user can implement callbacks - methods, that the game engine call at particular coments, such as onCollision, onRadarScan, onHit, etc.

Scripts are compiled to WebAssembly and executed on the server. Games have rounds and a time limit per rounda and per game.

Rendering is done with Pixi.js.
